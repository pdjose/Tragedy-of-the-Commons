// Tragedy of the Commons — WebSocket Server
// Run: node server.js
// Students connect via http://<your-ip>:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const os = require('os');
let localtunnel;
try { localtunnel = require('localtunnel'); } catch (e) { localtunnel = null; }

const PORT = process.env.PORT || 3000;
const isCloudHosted = !!process.env.PORT; // If a cloud provider provides PORT, assume we don't need localtunnel
const rooms = {};
let publicTunnelUrl = null;

// Get LAN IPs
function getNetworkIPs() {
    const ips = [];
    // If public tunnel started, return ONLY public tunnel or prioritize it
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips;
}

// Simple HTTP server to serve static files + API
const server = http.createServer((req, res) => {
    // API endpoint for server info
    if (req.url === '/api/info') {
        const ips = getNetworkIPs();
        let urls = ips.map(ip => 'http://' + ip + ':' + PORT);
        if (publicTunnelUrl) {
            // Prepend the public URL without adding port
            urls.unshift(publicTunnelUrl);
        }
        const info = { port: PORT, ips: ips, urls: urls };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(info));
        return;
    }

    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    const contentType = types[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.roomCode = null;
    ws.role = null;
    ws.pid = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
            case 'create-room': {
                const code = String(1000 + Math.floor(Math.random() * 9000));
                rooms[code] = {
                    admin: ws,
                    cfg: msg.cfg,
                    ais: msg.ais,
                    players: [],
                    allP: [],
                    state: null,
                    pendingHarvests: {},
                    expectedHumans: 0,
                    started: false,
                    roundTimer: null,
                    waitingForNext: false
                };
                ws.roomCode = code;
                ws.role = 'admin';
                ws.send(JSON.stringify({ type: 'room-created', code }));
                break;
            }

            case 'join': {
                const room = rooms[msg.code];
                if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); return; }
                if (room.started) { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started' })); return; }
                const pid = 'h' + room.players.length;
                const player = { id: pid, name: msg.name, human: true, ws };
                room.players.push(player);
                room.expectedHumans++;
                ws.roomCode = msg.code;
                ws.role = 'player';
                ws.pid = pid;
                ws.send(JSON.stringify({ type: 'joined', pid }));
                // Notify admin
                room.admin.send(JSON.stringify({
                    type: 'player-joined',
                    pid,
                    name: msg.name,
                    count: room.players.length
                }));
                break;
            }

            case 'start-game': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'admin') return;
                beginGame(room);
                break;
            }

            case 'reset-room': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'admin') return;
                if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
                beginGame(room);
                break;
            }

            case 'force-advance': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'admin') return;
                if (room.started && !room.state.over && !room.waitingForNext) {
                    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
                    room.players.forEach(p => {
                        if (room.pendingHarvests[p.id] === undefined) {
                            room.pendingHarvests[p.id] = 0;
                        }
                    });
                    resolveRound(room);
                }
                break;
            }

            case 'harvest': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'player') return;
                room.pendingHarvests[ws.pid] = msg.amount;
                const count = Object.keys(room.pendingHarvests).length;
                // Notify admin of progress
                room.admin.send(JSON.stringify({ type: 'harvest-progress', count, total: room.expectedHumans }));
                // If all harvests received, resolve round
                if (count >= room.expectedHumans) {
                    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
                    resolveRound(room);
                }
                break;
            }

            case 'next-round': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'admin') return;
                if (room.waitingForNext && !room.state.over) {
                    room.waitingForNext = false;
                    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
                    startRound(room);
                }
                break;
            }

            case 'change-ai-strat': {
                const room = rooms[ws.roomCode];
                if (!room || ws.role !== 'admin') return;
                const aiPlayer = room.allP.find(p => p.id === msg.aiId);
                if (aiPlayer && !aiPlayer.human) {
                    aiPlayer.strat = msg.strat;
                }
                break;
            }
        }

        ws.on('close', () => {
            if (ws.role === 'admin' && ws.roomCode && rooms[ws.roomCode]) {
                // Notify players admin disconnected
                broadcastToRoom(rooms[ws.roomCode], { type: 'error', msg: 'Host disconnected' });
                delete rooms[ws.roomCode];
            }
        });
    });
});

function broadcastToRoom(room, msg) {
    const data = JSON.stringify(msg);
    room.players.forEach(p => {
        if (p.ws.readyState === 1) p.ws.send(data);
    });
    if (room.admin && room.admin.readyState === 1) room.admin.send(data);
}

function beginGame(room) {
    room.started = true;
    room.pendingHarvests = {};
    room.waitingForNext = false;
    const colors = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#2dd4bf', '#e879f9', '#818cf8', '#34d399'];
    room.allP = [];
    room.players.forEach((p, i) => {
        room.allP.push({ id: p.id, name: p.name, emoji: '🧑', color: colors[i % colors.length], human: true, strat: 'Human', earn: 0, last: 0, harvests: [] });
    });
    room.ais.forEach((a, i) => {
        room.allP.push({ id: 'a' + i, name: a.name, emoji: a.emoji, color: a.color || colors[(room.players.length + i) % colors.length], human: false, strat: a.strat, earn: 0, last: 0, harvests: [] });
    });
    room.state = { rnd: 1, pop: room.cfg.K, hist: [room.cfg.K], over: false, dead: false, avgH: 5 };
    const playerInfo = room.allP.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, human: p.human }));
    broadcastToRoom(room, { type: 'game-started', cfg: room.cfg, players: playerInfo });
    startRound(room);
}

function startRound(room) {
    room.pendingHarvests = {};
    room.waitingForNext = false;
    const timerSec = room.cfg.TIMER || 0;
    const msg = { type: 'round-start', rnd: room.state.rnd, pop: Math.round(room.state.pop), timer: timerSec };
    broadcastToRoom(room, msg);
    // If timer is set, auto-resolve when timer expires (for players who didn't submit)
    if (timerSec > 0) {
        room.roundTimer = setTimeout(() => {
            room.roundTimer = null;
            // Auto-submit 0 for players who haven't submitted
            room.players.forEach(p => {
                if (room.pendingHarvests[p.id] === undefined) {
                    room.pendingHarvests[p.id] = 0;
                }
            });
            resolveRound(room);
        }, timerSec * 1000);
    }
}

function aiH(v, state, cfg, n) {
    const pop = state.pop, rg = cfg.R * pop * (1 - pop / cfg.K), fs = Math.max(0, rg / n);
    switch (v.strat) {
        case 'Sustainable': return Math.min(Math.round(fs), Math.floor(pop / n));
        case 'Greedy': return Math.min(Math.floor(pop * 0.25), Math.round(cfg.K * 0.18) + Math.floor(Math.random() * 3));
        case 'Copycat': return state.rnd === 1 ? Math.round(fs) : Math.round(state.avgH);
        case 'Adaptive': { const r = pop / cfg.K; if (r > 0.7) return Math.min(Math.round(fs * 1.5), Math.round(cfg.K * 0.15)); if (r > 0.3) return Math.round(fs); return Math.max(0, Math.round(fs * 0.5)); }
        case 'Cooperative': return Math.max(1, Math.floor(fs * 0.5));
        default: return 0;
    }
}

function resolveRound(room) {
    const S = room.state, cfg = room.cfg;
    const harvests = []; let tot = 0, hSum = 0, hCnt = 0;

    room.allP.forEach(p => {
        let h;
        if (p.human) {
            h = Math.min(room.pendingHarvests[p.id] || 0, Math.max(0, Math.floor(S.pop - tot)));
        } else {
            h = Math.min(aiH(p, S, cfg, room.allP.length), Math.max(0, Math.floor(S.pop - tot)));
        }
        p.last = h; p.earn += h * cfg.PRICE; p.harvests.push(h); tot += h;
        if (p.human) { hSum += h; hCnt++; }
        harvests.push({ id: p.id, name: p.name, emoji: p.emoji, h });
    });

    S.avgH = hCnt > 0 ? hSum / hCnt : 5;
    S.pop = Math.max(0, S.pop - tot);
    let rg = 0;
    const CRIT = Math.max(5, Math.round(cfg.K * 0.1));
    if (S.pop > CRIT) { rg = cfg.R * S.pop * (1 - S.pop / cfg.K); S.pop = Math.min(cfg.K, S.pop + rg); }
    else if (S.pop > 0) { rg = S.pop * 0.05; S.pop += rg; }
    S.pop = Math.round(S.pop * 100) / 100;
    S.hist.push(Math.round(S.pop));
    if (S.pop < 1) { S.pop = 0; S.dead = true; }

    const prevRnd = S.rnd;
    S.rnd++;
    if (S.rnd > cfg.MR || S.dead) S.over = true;

    broadcastToRoom(room, {
        type: 'round-result',
        harvests, pop: Math.round(S.pop), rnd: S.rnd,
        hist: S.hist, dead: S.dead, over: S.over,
        total: tot, regrowth: Math.round(rg), prevRnd
    });

    if (S.over) {
        const finalPlayers = room.allP.map(p => ({
            id: p.id, name: p.name, emoji: p.emoji, color: p.color,
            human: p.human, strat: p.strat, earn: p.earn, last: p.last, harvests: p.harvests
        }));
        broadcastToRoom(room, { type: 'game-over', dead: S.dead, pop: S.pop, hist: S.hist, finalPlayers });
        delete rooms[room];
    } else {
        // Wait for admin to advance (or timer in next startRound)
        room.waitingForNext = true;
        const timerSec = room.cfg.TIMER || 0;
        if (timerSec > 0) {
            // Auto-advance after showing results for a few seconds
            room.roundTimer = setTimeout(() => {
                room.roundTimer = null;
                if (room.waitingForNext) {
                    room.waitingForNext = false;
                    startRound(room);
                }
            }, Math.min(timerSec * 1000, 8000)); // show results for up to 8s then auto-advance
        }
    }
}

server.listen(PORT, async () => {
    console.log('\n🐟 Tragedy of the Commons Server');
    console.log('================================');
    console.log(`Local:   http://localhost:${PORT}`);
    // Show LAN IP
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`Network: http://${net.address}:${PORT}`);
            }
        }
    }

    if (localtunnel && !isCloudHosted) {
        console.log('\nSetting up public internet tunnel (localtunnel)...');
        try {
            const tunnel = await localtunnel({ port: PORT });
            publicTunnelUrl = tunnel.url;
            console.log(`🌍 Public Internet URL: ${tunnel.url}`);
            console.log('\nShare this Public URL with students to play from ANYWHERE.');
            console.log('NOTE: Players must click "Click to Continue" on the first visit for the game to work.');

            tunnel.on('close', () => {
                console.log('Public tunnel closed.');
            });
        } catch (e) {
            console.log('Failed to start public tunnel:', e.message);
        }
    } else {
        console.log('\nShare the Network URL with students on the same Wi-Fi.');
    }

    console.log('\nPress Ctrl+C to stop the server.\n');
});
