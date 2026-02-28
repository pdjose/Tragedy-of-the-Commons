// Tragedy of the Commons — WebSocket Client Engine
// Supports multi-room admin dashboard & multiple human players per room

var CFG = { R: 0.3, K: 100, MR: 20, PRICE: 3, CRIT: 10, TIMER: 0 };
var STRATS = ['Sustainable', 'Greedy', 'Copycat', 'Adaptive', 'Cooperative'];
var COLORS = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#2dd4bf', '#e879f9', '#818cf8', '#34d399'];
var AI_EMO = ['🤖', '🦾', '🧠', '💻', '🎭', '🔮', '🦿', '🛸'];

var ais = [
    { name: 'Sara', emoji: '🌿', strat: 'Sustainable', color: '#4ade80' },
    { name: 'Gus', emoji: '💰', strat: 'Greedy', color: '#fbbf24' },
    { name: 'Cora', emoji: '🪞', strat: 'Copycat', color: '#a78bfa' },
    { name: 'Alex', emoji: '🧠', strat: 'Adaptive', color: '#38bdf8' }
];

// Global state
var S, allP, myId, myRole, roomCode, ws;
var fish = [], ripples = [], lakeOn = false;
var countdownInterval = null;
var playerHarvests = {};
var networkURL = '';

// Admin multi-room state
var adminRooms = []; // {ws, code, players:[], status:'waiting'|'playing'|'ended', state:null}
var activeAdminRoom = null; // reference to the room being viewed

// === THEME MANAGEMENT ===
function toggleTheme() {
    var isLight = document.body.getAttribute('data-theme') === 'light';
    if (isLight) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'dark');
    } else {
        document.body.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
}
var savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') document.body.setAttribute('data-theme', 'light');

function el(id) { return document.getElementById(id); }
function go(n) {
    document.querySelectorAll('.scr').forEach(function (s) { s.classList.remove('active'); });
    el(n + '-scr').classList.add('active');
    if (n === 'admin') renderAdmin();
}
function stab(b, t) {
    document.querySelectorAll('.etab').forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('.ep').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active'); el('pane-' + t).classList.add('active');
}
function usl() { el('slv').textContent = el('hsl').value + ' fish'; }

// === ADMIN PANEL ===
function renderAdmin() {
    var a = ''; ais.forEach(function (ai, i) {
        var opts = ''; STRATS.forEach(function (s) { opts += '<option value="' + s + '"' + (ai.strat === s ? ' selected' : '') + '>' + s + '</option>'; });
        a += '<div class="pc"><span style="font-size:1.4rem">' + ai.emoji + '</span><div style="flex:1"><input type="text" value="' + ai.name + '" onchange="ais[' + i + '].name=this.value" style="font-weight:600;width:100%"><div style="margin-top:6px"><select onchange="ais[' + i + '].strat=this.value">' + opts + '</select></div></div><button class="bx" onclick="ais.splice(' + i + ',1);renderAdmin()">✕</button></div>';
    });
    el('ai-grid').innerHTML = a;
    el('p-r').value = CFG.R; el('p-k').value = CFG.K; el('p-mr').value = CFG.MR;
    renderRoomDashboard();
}
function addAI() {
    if (ais.length >= 8) return;
    var i = ais.length;
    ais.push({ name: 'Bot ' + (i + 1), emoji: AI_EMO[i % AI_EMO.length], strat: 'Adaptive', color: COLORS[(i + 2) % COLORS.length] });
    renderAdmin();
}

// === MULTI-ROOM DASHBOARD ===
function createRoom(mode) {
    if (!mode) mode = 'init';
    var countInput = el('room-count-' + mode);
    var count = countInput ? Math.max(1, Math.min(20, parseInt(countInput.value) || 1)) : 1;

    CFG.R = Math.max(0.05, Math.min(1, parseFloat(el('p-r').value) || 0.3));
    CFG.K = Math.max(50, Math.min(500, parseInt(el('p-k').value) || 100));
    CFG.MR = Math.max(5, Math.min(50, parseInt(el('p-mr').value) || 20));
    CFG.TIMER = Math.max(0, Math.min(300, parseInt(el('p-timer').value) || 0));
    CFG.PRICE = 3;
    myRole = 'admin';

    if (mode === 'init') {
        el('init-create-section').style.display = 'none';
        el('room-section').style.display = 'block';
    }

    // Fetch network URL once
    if (!networkURL) {
        // If we're not on localhost (e.g. on render/glitch), the network URL is just the current domain
        if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            networkURL = location.origin;
            renderRoomDashboard();
        } else {
            fetch('/api/info').then(function (r) { return r.json(); }).then(function (info) {
                networkURL = (info.urls && info.urls.length > 0) ? info.urls[0] : location.origin;
                renderRoomDashboard();
            }).catch(function () { networkURL = location.origin; });
        }
    }

    for (var i = 0; i < count; i++) {
        (function () {
            var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var roomWS = new WebSocket(proto + '//' + location.host);
            var room = {
                ws: roomWS, code: null, players: [], status: 'connecting',
                cfg: JSON.parse(JSON.stringify(CFG)),
                aisConfig: JSON.parse(JSON.stringify(ais)),
                allP: [], state: null, harvests: {}, hist: []
            };
            adminRooms.push(room);

            roomWS.onopen = function () {
                roomWS.send(JSON.stringify({ type: 'create-room', cfg: room.cfg, ais: room.aisConfig }));
            };
            roomWS.onmessage = function (e) {
                var d; try { d = JSON.parse(e.data); } catch (x) { return; }
                handleAdminRoomMsg(room, d);
            };
            roomWS.onclose = function () {
                room.status = 'disconnected';
                renderRoomDashboard();
            };
        })();
    }

    renderRoomDashboard();
}

function handleAdminRoomMsg(room, d) {
    switch (d.type) {
        case 'room-created':
            room.code = d.code;
            room.status = 'waiting';
            renderRoomDashboard();
            break;
        case 'player-joined':
            room.players.push({ pid: d.pid, name: d.name });
            renderRoomDashboard();
            break;
        case 'harvest-progress':
            if (activeAdminRoom === room) {
                el('tb').innerHTML = '⏳ Received ' + d.count + '/' + d.total + ' harvests...';
            }
            break;
        case 'game-started':
            room.status = 'playing';
            room.allP = d.players.map(function (p) {
                return { id: p.id, name: p.name, emoji: p.emoji, color: p.color, human: p.human, strat: 'AI', earn: 0, last: 0 };
            });
            room.state = { rnd: 1, pop: room.cfg.K, hist: [room.cfg.K], over: false, dead: false };
            room.harvests = {};
            renderRoomDashboard();
            // If admin is viewing this room, update sim screen
            if (activeAdminRoom === room) loadRoomIntoSim(room);
            break;
        case 'round-start':
            room.state.rnd = d.rnd;
            room.state.pop = d.pop;
            if (activeAdminRoom === room) {
                el('tb').innerHTML = '📡 Round ' + d.rnd + ' — Waiting for player harvests...';
                el('btn-next').disabled = true;
                el('btn-next').textContent = '⏳ Waiting...';
                if (d.timer && d.timer > 0) startCountdown(d.timer);
                else el('timer-display').textContent = '';
                updateUI();
            }
            break;
        case 'round-result':
            d.harvests.forEach(function (rh) {
                var p = room.allP.find(function (x) { return x.id === rh.id; });
                if (p) { p.last = rh.h; p.earn += rh.h * room.cfg.PRICE; }
                if (!room.harvests[rh.id]) room.harvests[rh.id] = [];
                room.harvests[rh.id].push(rh.h);
            });
            room.state.pop = d.pop; room.state.rnd = d.rnd; room.state.hist = d.hist;
            room.state.dead = d.dead; room.state.over = d.over;
            if (activeAdminRoom === room) {
                allP = room.allP; S = room.state; playerHarvests = room.harvests; CFG = room.cfg;
                addLog(d.prevRnd, d.harvests, d.total, d.regrowth);
                updateUI();
                showRoundOutcome(d);
                if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
                if (S.over) {
                    el('btn-next').disabled = true; el('btn-next').textContent = '🏁 Game Over';
                    el('timer-display').textContent = '';
                } else {
                    el('btn-next').disabled = false; el('btn-next').textContent = '▶ Next Round';
                    el('timer-display').textContent = room.cfg.TIMER > 0 ? 'Auto-advancing...' : 'Click to advance';
                }
            }
            break;
        case 'game-over':
            room.status = 'ended';
            room.state.over = true; room.state.dead = d.dead;
            room.state.pop = d.pop; room.state.hist = d.hist;
            if (d.finalPlayers) room.allP = d.finalPlayers;
            renderRoomDashboard();
            if (activeAdminRoom === room) {
                allP = room.allP; S = room.state; playerHarvests = room.harvests; CFG = room.cfg;
                setTimeout(showEnd, 600);
            }
            break;
    }
}

function renderRoomDashboard() {
    var dash = el('room-dashboard');
    if (!dash) return;
    if (adminRooms.length === 0) { dash.innerHTML = '<div style="color:var(--t3);text-align:center;padding:16px">No rooms created yet. Click "Create Room" above.</div>'; return; }

    var h = '';
    if (networkURL) {
        h += '<div style="background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:10px;padding:12px;margin-bottom:16px;text-align:center">';
        h += '<div style="font-size:.8rem;color:var(--t3);margin-bottom:4px">🌐 Students connect at:</div>';
        h += '<div style="font-family:monospace;font-size:1.1rem;font-weight:700;color:var(--ac);cursor:pointer;user-select:all" onclick="copyURL(\'' + networkURL + '\')">' + networkURL + ' <span style="font-size:.7rem;color:var(--t3)">📋 click to copy</span></div>';
        h += '<div style="margin-top:12px"><button class="btn btn-s" onclick="printRoomList()" style="background:var(--cd);color:var(--t1);border:1px solid var(--bd)">📄 Print / Save as PDF</button></div>';
        h += '</div>';
    }

    adminRooms.forEach(function (room, idx) {
        var statColor = room.status === 'waiting' ? 'var(--yl)' : room.status === 'playing' ? 'var(--gn)' : room.status === 'ended' ? 'var(--t3)' : 'var(--rd)';
        var statLabel = room.status === 'waiting' ? '⏳ Waiting' : room.status === 'playing' ? '🟢 Playing' : room.status === 'ended' ? '🏁 Ended' : room.status === 'connecting' ? '🔄 Connecting...' : '❌ Disconnected';

        h += '<div style="background:var(--c2);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:12px">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        h += '<div><span style="font-weight:700;font-size:1.2rem">Room </span><span style="font-family:monospace;font-size:1.4rem;font-weight:700;color:var(--ac);letter-spacing:3px">' + (room.code || '...') + '</span></div>';
        h += '<span style="font-size:.85rem;color:' + statColor + ';font-weight:600">' + statLabel + '</span></div>';

        // Player list
        h += '<div style="font-size:.85rem;color:var(--t2);margin-bottom:8px">👥 ' + room.players.length + ' human player' + (room.players.length !== 1 ? 's' : '') + ':';
        if (room.players.length > 0) {
            h += ' ' + room.players.map(function (p) { return p.name; }).join(', ');
        } else {
            h += ' <span style="color:var(--t3)">none yet</span>';
        }
        h += '</div>';

        // Room info
        h += '<div style="font-size:.75rem;color:var(--t3);margin-bottom:10px">';
        h += 'K=' + room.cfg.K + ' | R=' + room.cfg.R + ' | Rounds=' + room.cfg.MR + ' | AI=' + room.aisConfig.length;
        if (room.cfg.TIMER > 0) h += ' | Timer=' + room.cfg.TIMER + 's';
        h += '</div>';

        // Action buttons
        h += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
        if (room.status === 'waiting') {
            var canStart = room.players.length > 0 || room.aisConfig.length > 0;
            h += '<button class="btn btn-s" onclick="startAdminRoom(' + idx + ')"' + (!canStart ? ' disabled title="Need at least 1 player or AI"' : '') + '>▶ Start Game</button>';
        }
        if (room.status === 'playing') {
            h += '<button class="btn btn-s" onclick="viewAdminRoom(' + idx + ')">👁 Monitor</button>';
            h += '<button class="btn btn-s" onclick="adminForceAdvance(' + idx + ')" style="background:var(--c3);color:var(--t1)" title="Force all unsubmitted players to 0 and advance">⏩ Force Turn</button>';
            if (room.state) h += '<span style="margin-left:auto;font-size:.85rem;color:var(--t2)">Round ' + room.state.rnd + ' | Pop: ' + Math.round(room.state.pop) + '</span>';
        }
        if (room.status === 'ended') {
            h += '<button class="btn btn-s" onclick="viewAdminRoomEnd(' + idx + ')">📊 View Results</button>';
        }
        if (room.status !== 'connecting' && room.status !== 'disconnected') {
            h += '<button class="btn btn-s" onclick="adminResetRoom(' + idx + ')" style="background:rgba(248,113,113,0.1);color:var(--rd);border:1px solid rgba(248,113,113,0.2)' + (room.status === 'playing' ? ';margin-left:auto' : '') + '">🔄 Reset Game</button>';
        }
        h += '</div></div>';
    });

    dash.innerHTML = h;
}

function adminResetAllRooms() {
    if (adminRooms.length > 0) {
        if (confirm('Are you sure you want to reset the ENTIRE game dashboard and delete all rooms? This cannot be undone.')) {
            adminRooms.forEach(function (room) {
                if (room.ws) room.ws.close();
            });
            adminRooms = [];
            el('room-section').style.display = 'none';
            el('init-create-section').style.display = 'block';
            activeAdminRoom = null;
            renderRoomDashboard();
        }
    }
}

function printRoomList() {
    var win = window.open('', '_blank');
    var html = '<!DOCTYPE html><html><head><title>Tragedy of the Commons - Room List</title>';
    html += '<style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 30px; color: #1e293b; } ';
    html += 'h2 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; } ';
    html += '.url-box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 15px; border-radius: 8px; font-size: 1.1em; margin-bottom: 25px; } ';
    html += 'table { width: 100%; border-collapse: collapse; margin-top: 10px; } ';
    html += 'th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; vertical-align: top; } ';
    html += 'th { background: #f1f5f9; color: #334155; font-weight: 600; } ';
    html += '.code { font-family: monospace; font-size: 1.3em; font-weight: bold; color: #0284c7; letter-spacing: 2px; } ';
    html += 'td.status { font-weight: 500; }';
    html += '</style></head><body>';

    html += '<h2>🐟 Tragedy of the Commons — Simulation Rooms</h2>';
    if (networkURL) {
        html += '<div class="url-box"><strong>Network Connection URL:</strong> <span style="font-family:monospace; color:#0284c7; margin-left:10px;">' + networkURL + '</span></div>';
    }

    html += '<table><thead><tr><th width="20%">Room Code</th><th width="45%">Status & Players</th><th width="35%">Configuration</th></tr></thead><tbody>';

    adminRooms.forEach(function (r) {
        var stat = r.status.charAt(0).toUpperCase() + r.status.slice(1);
        var pList = r.players.length > 0 ? r.players.map(function (p) { return p.name; }).join(', ') : '<em>None</em>';
        var cfgStr = 'K: ' + r.cfg.K + '<br>R: ' + r.cfg.R + '<br>Rounds: ' + r.cfg.MR + '<br>AI Bots: ' + r.aisConfig.length;
        if (r.cfg.TIMER > 0) cfgStr += '<br>Timer: ' + r.cfg.TIMER + 's';

        html += '<tr>';
        html += '<td><div class="code">' + (r.code || '...') + '</div></td>';
        html += '<td><div class="status" style="margin-bottom:8px">Status: ' + stat + '</div><div>Players (' + r.players.length + '): ' + pList + '</div></td>';
        html += '<td style="font-size:0.9em; line-height:1.4">' + cfgStr + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table>';
    html += '<p style="margin-top: 40px; font-size: 0.85em; color: #64748b; text-align: center;">Generated on ' + new Date().toLocaleString() + '</p>';
    html += '<script>window.onload = function() { setTimeout(function(){ window.print(); window.close(); }, 500); }</script>';
    html += '</body></html>';

    win.document.write(html);
    win.document.close();
}

function startAdminRoom(idx) {
    var room = adminRooms[idx];
    if (!room) return;
    if (room.players.length < 1 && room.aisConfig.length < 1) { alert('Need at least 1 player or AI to start.'); return; }
    room.ws.send(JSON.stringify({ type: 'start-game' }));
}

function viewAdminRoom(idx) {
    var room = adminRooms[idx];
    if (!room) return;
    activeAdminRoom = room;
    allP = room.allP; S = room.state; playerHarvests = room.harvests; CFG = room.cfg;
    fish = []; lakeOn = false;
    go('sim');
    el('mr').textContent = CFG.MR;
    el('btn-h').style.display = 'none';
    el('htitle').textContent = 'Admin — Room ' + room.code;
    el('admin-bar').style.display = 'block';
    requestAnimationFrame(function () {
        setupCanvas(); renderVCards(); updateUI();
        if (!lakeOn) { lakeOn = true; animLake(); }
    });
}

function viewAdminRoomEnd(idx) {
    var room = adminRooms[idx];
    if (!room) return;
    activeAdminRoom = room;
    allP = room.allP; S = room.state; playerHarvests = room.harvests; CFG = room.cfg;
    showEnd();
}

function loadRoomIntoSim(room) {
    allP = room.allP; S = room.state; playerHarvests = room.harvests; CFG = room.cfg;
    fish = []; lakeOn = false;
    go('sim');
    el('mr').textContent = CFG.MR;
    el('btn-h').style.display = 'none';
    el('htitle').textContent = 'Admin — Room ' + room.code;
    el('admin-bar').style.display = 'block';
    requestAnimationFrame(function () {
        setupCanvas(); renderVCards(); updateUI();
        if (!lakeOn) { lakeOn = true; animLake(); }
    });
}

function adminNextRound() {
    if (myRole === 'admin' && activeAdminRoom && activeAdminRoom.ws) {
        activeAdminRoom.ws.send(JSON.stringify({ type: 'next-round' }));
        el('btn-next').disabled = true;
        el('btn-next').textContent = '⏳ Starting...';
        el('timer-display').textContent = '';
    }
}

function adminForceAdvance(idx) {
    var room = adminRooms[idx];
    if (room && room.ws && room.status === 'playing') {
        if (confirm('Force turn advance for room ' + room.code + '?\nUnresponsive players will auto-harvest 0.')) {
            room.ws.send(JSON.stringify({ type: 'force-advance' }));
        }
    }
}

function adminResetRoom(idx) {
    var room = adminRooms[idx];
    if (room && room.ws) {
        if (confirm('Reset room ' + room.code + '?\nThis clears all history and starts a fresh game with the same human players and same settings.')) {
            room.ws.send(JSON.stringify({ type: 'reset-room' }));
            room.status = 'playing';
            renderRoomDashboard();
        }
    }
}

function copyURL(url) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
    } else {
        var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
}
function copyNetworkURL() { copyURL(networkURL || location.origin); }

function backToRoomDashboard() {
    activeAdminRoom = null;
    go('admin');
}

// === PLAYER FLOW (unchanged) ===
function connectWS(callback) {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);
    ws.onopen = function () { if (callback) callback(); };
    ws.onmessage = function (e) {
        var d; try { d = JSON.parse(e.data); } catch (x) { return; }
        handlePlayerMsg(d);
    };
    ws.onclose = function () {
        if (myRole === 'player') alert('Connection to server lost. Please refresh.');
    };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function joinGame() {
    var code = el('j-code').value.trim();
    var name = el('j-name').value.trim() || 'Player';
    if (code.length !== 4) { alert('Enter a 4-digit room code.'); return; }
    myRole = 'player';
    connectWS(function () { send({ type: 'join', code: code, name: name }); });
    go('wait');
    el('wait-title').textContent = 'Connecting...';
    el('wait-msg').textContent = 'Connecting to game server...';
}

function handlePlayerMsg(d) {
    switch (d.type) {
        case 'joined':
            myId = d.pid;
            el('wait-title').textContent = '✅ Joined!';
            el('wait-msg').textContent = 'Connected! Waiting for host to start...';
            break;
        case 'error':
            alert(d.msg);
            break;
        case 'game-started':
            CFG = d.cfg; CFG.CRIT = Math.max(5, Math.round(CFG.K * 0.1));
            allP = d.players.map(function (p) {
                return { id: p.id, name: p.name, emoji: p.emoji, color: p.color, human: p.human, strat: 'AI', earn: 0, last: 0 };
            });
            S = { rnd: 1, pop: CFG.K, hist: [CFG.K], over: false, dead: false };
            playerHarvests = {};
            fish = []; lakeOn = false;
            go('sim');
            el('mr').textContent = CFG.MR;
            el('btn-h').style.display = '';
            el('admin-bar').style.display = 'none';
            var me = allP.find(function (p) { return p.id === myId; });
            el('htitle').textContent = (me ? me.name : 'Your') + "'s Harvest";
            requestAnimationFrame(function () {
                setupCanvas(); renderVCards(); updateUI();
                if (!lakeOn) { lakeOn = true; animLake(); }
            });
            break;
        case 'round-start':
            if (myRole === 'player' && window.pendingResultData) {
                window.pendingResultData.forEach(function (rh) {
                    if (rh.id !== myId) {
                        var p = allP.find(function (x) { return x.id === rh.id; });
                        if (p) { p.last = rh.h; p.earn += rh.h * CFG.PRICE; }
                        if (!playerHarvests[rh.id]) playerHarvests[rh.id] = [];
                        playerHarvests[rh.id].push(rh.h);
                    }
                });
                window.pendingResultData = null;
            }
            S.rnd = d.rnd; S.pop = d.pop;
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            el('tb').innerHTML = '<span style="color:var(--ac)">Round ' + S.rnd + ' — Choose your harvest!</span>';
            el('btn-h').disabled = false;
            if (d.timer && d.timer > 0) startCountdown(d.timer);
            else el('timer-display').textContent = '';
            updateUI();
            break;
        case 'round-result':
            if (myRole === 'player') window.pendingResultData = d.harvests;
            d.harvests.forEach(function (rh) {
                if (myRole === 'admin' || rh.id === myId) {
                    var p = allP.find(function (x) { return x.id === rh.id; });
                    if (p) { p.last = rh.h; p.earn += rh.h * CFG.PRICE; }
                    if (!playerHarvests[rh.id]) playerHarvests[rh.id] = [];
                    playerHarvests[rh.id].push(rh.h);
                }
            });
            S.pop = d.pop; S.rnd = d.rnd; S.hist = d.hist; S.dead = d.dead; S.over = d.over;
            if (myRole === 'admin') addLog(d.prevRnd, d.harvests, d.total, d.regrowth);
            updateUI();
            showRoundOutcome(d);
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            if (S.over) { el('btn-h').disabled = true; }
            else { el('btn-h').disabled = true; }
            break;
        case 'game-over':
            S.over = true; S.dead = d.dead; S.pop = d.pop; S.hist = d.hist;
            if (d.finalPlayers) allP = d.finalPlayers;
            setTimeout(showEnd, 600);
            break;
    }
}

function submitHarvest() {
    if (myRole === 'player' && ws) {
        var h = Math.min(parseInt(el('hsl').value), Math.floor(S.pop));
        send({ type: 'harvest', amount: h });
        el('btn-h').disabled = true;
        el('tb').innerHTML = '⏳ Harvest submitted! Waiting for others...';
    }
}

function startCountdown(seconds) {
    if (countdownInterval) clearInterval(countdownInterval);
    var remaining = seconds;
    var timerEl = el('timer-display');
    var updateTimer = function () {
        var mins = Math.floor(remaining / 60);
        var secs = remaining % 60;
        var timeStr = mins > 0 ? mins + ':' + (secs < 10 ? '0' : '') + secs : secs + 's';
        timerEl.innerHTML = '⏱️ <strong style="color:' + (remaining <= 10 ? 'var(--rd)' : 'var(--ac)') + '">' + timeStr + '</strong> remaining';
        if (remaining <= 0) {
            clearInterval(countdownInterval); countdownInterval = null;
            timerEl.textContent = "⏱️ Time's up!";
            if (myRole === 'player' && !el('btn-h').disabled) {
                send({ type: 'harvest', amount: 0 });
                el('btn-h').disabled = true;
                el('tb').innerHTML = '⏱️ Time expired — auto-submitted 0 fish';
            }
        }
        remaining--;
    };
    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
}

// === ROUND OUTCOME DISPLAY ===
function showRoundOutcome(d) {
    var popChg = d.hist.length > 1 ? d.hist[d.hist.length - 1] - d.hist[d.hist.length - 2] : 0;
    var outHtml = '<div style="text-align:left;max-width:600px;margin:0 auto">';
    outHtml += '<div style="font-weight:700;font-size:1.05rem;margin-bottom:8px">📊 Round ' + d.prevRnd + ' Results</div>';

    if (myRole === 'admin') {
        outHtml += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 16px;font-size:.88rem">';
        outHtml += '<div style="color:var(--t3);font-weight:600">Player</div><div style="color:var(--t3);font-weight:600;text-align:right">Harvest</div><div style="color:var(--t3);font-weight:600;text-align:right">Earned</div>';
        d.harvests.forEach(function (rh) {
            var isMe = (rh.id === myId);
            outHtml += '<div style="' + (isMe ? 'color:var(--ac);font-weight:700' : '') + '">' + rh.emoji + ' ' + rh.name + (isMe ? ' (You)' : '') + '</div>';
            outHtml += '<div style="text-align:right;' + (isMe ? 'color:var(--ac);font-weight:700' : '') + '">' + rh.h + ' 🐟</div>';
            outHtml += '<div style="text-align:right;color:var(--gn);' + (isMe ? 'font-weight:700' : '') + '">+$' + (rh.h * CFG.PRICE) + '</div>';
        });
        outHtml += '</div>';
    } else {
        var myH = d.harvests.find(function (h) { return h.id === myId; });
        if (myH) {
            outHtml += '<div style="margin-bottom:12px;font-size:1.1rem">You harvested: <strong style="color:var(--ac)">' + myH.h + ' 🐟</strong> <span style="font-size:.9rem;color:var(--gn)">(+$' + (myH.h * CFG.PRICE) + ')</span></div>';
        }
        outHtml += '<div style="font-size:.9rem;color:var(--t2);margin-bottom:12px;font-style:italic">Other players\' actions will be revealed when the next round begins.</div>';
    }

    outHtml += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bd);display:flex;gap:20px;font-size:.85rem">';
    outHtml += '<span>Total: <strong>' + d.total + '</strong></span>';
    outHtml += '<span>Regrowth: <strong style="color:var(--gn)">+' + d.regrowth + '</strong></span>';
    outHtml += '<span>Pop: <strong style="color:' + (popChg >= 0 ? 'var(--gn)' : 'var(--rd)') + '">' + Math.round(S.pop) + ' (' + (popChg >= 0 ? '+' : '') + Math.round(popChg) + ')</strong></span>';
    outHtml += '</div></div>';
    el('tb').innerHTML = outHtml;
}

// === UI ===
function renderVCards() {
    var h = ''; allP.forEach(function (p) {
        var isMe = (p.id === myId);
        var subTxt = p.human ? 'Human' : 'AI';

        if (myRole === 'admin' && !p.human) {
            var strats = ['Sustainable', 'Greedy', 'Copycat', 'Adaptive', 'Cooperative'];
            var opts = '';
            strats.forEach(function (s) {
                opts += '<option value="' + s + '"' + (p.strat === s ? ' selected' : '') + '>' + s + '</option>';
            });
            subTxt = 'AI <select style="background:var(--cd);color:var(--t2);border:1px solid var(--bd);border-radius:4px;font-size:0.75rem;padding:2px;margin-left:4px" onchange="changeAIStrat(\'' + p.id + '\', this.value)" onclick="event.stopPropagation()">' + opts + '</select>';
        }

        h += '<div class="vc' + (isMe ? ' cur' : '') + '" id="vc-' + p.id + '"><div class="vn"><span>' + p.emoji + '</span>' + p.name + (isMe ? ' (You)' : '') + '</div><div class="vs2" style="display:flex;align-items:center">' + subTxt + '</div><div class="vst"><span class="vh">Last: ?</span><span class="vtot">$' + p.earn + '</span></div></div>';
    }); el('vg').innerHTML = h;
}

function changeAIStrat(aiId, strat) {
    if (myRole === 'admin' && activeAdminRoom && activeAdminRoom.ws) {
        activeAdminRoom.ws.send(JSON.stringify({ type: 'change-ai-strat', aiId: aiId, strat: strat }));
        var p = allP.find(function (x) { return x.id === aiId; });
        if (p) p.strat = strat;
    }
}
function updateUI() {
    el('rn').textContent = Math.min(S.rnd, CFG.MR);
    el('sp').textContent = Math.round(S.pop);
    var hp = (S.pop / CFG.K) * 100;
    el('hfl').style.height = hp + '%';
    el('hvl').textContent = Math.round(hp) + '%';
    if (S.hist.length > 1) {
        var d = S.hist[S.hist.length - 1] - S.hist[S.hist.length - 2];
        var e = el('schg'); e.textContent = (d >= 0 ? '+' : '') + Math.round(d); e.className = 'ss ' + (d >= 0 ? 'cup' : 'cdn');
    }
    var msy = Math.round(CFG.K * CFG.R / 4 * 10) / 10;
    var osy = Math.round(msy * 0.8 * 10) / 10;
    el('smsy').textContent = msy + ' fish'; el('sosy').textContent = osy + ' fish';
    el('srg').textContent = S.hist.length > 1 ? ((S.hist[S.hist.length - 1] - S.hist[S.hist.length - 2]) >= 0 ? '+' : '') + Math.round(S.hist[S.hist.length - 1] - S.hist[S.hist.length - 2]) : '—';
    if (el('edu-k')) { el('edu-k').textContent = CFG.K; el('edu-r').textContent = CFG.R; el('edu-msy').textContent = msy; }
    if (myId) { var me = allP.find(function (p) { return p.id === myId; }); if (me) el('se').textContent = '$' + me.earn; }
    else if (myRole === 'admin') { var totE = 0; allP.forEach(function (p) { totE += p.earn; }); el('se').textContent = '$' + totE; }
    allP.forEach(function (p) {
        var c = document.getElementById('vc-' + p.id);
        if (c) { c.querySelector('.vh').textContent = 'Last: ' + (p.last != null ? p.last : '?'); c.querySelector('.vtot').textContent = '$' + p.earn; }
    });
    drawChart(el('ccv'), S.hist);
}
function addLog(rnd, hs, tot, rg) {
    var log = el('rl'); if (log.querySelector('.le')) log.innerHTML = '';
    var d = hs.map(function (r) { return r.emoji + ' ' + r.name + ': ' + r.h; }).join(' · ');
    var e = document.createElement('div'); e.className = 'lent';
    e.innerHTML = '<div class="lr">Round ' + rnd + ' — Total: ' + tot + '</div><div class="ld">' + d + ' | Regrowth: +' + rg + '</div>';
    log.insertBefore(e, log.firstChild);
}

// === CHART ===
function drawChart(cv, data) {
    if (!cv || !cv.getContext) return; var rect = cv.getBoundingClientRect(); if (rect.width < 10) return;
    var ctx = cv.getContext('2d'), dp = window.devicePixelRatio || 1; cv.width = rect.width * dp; cv.height = rect.height * dp; ctx.scale(dp, dp);
    var W = rect.width, H = rect.height; ctx.clearRect(0, 0, W, H); if (data.length < 2) return;
    var p = { t: 10, r: 10, b: 24, l: 34 }, gW = W - p.l - p.r, gH = H - p.t - p.b, xs = gW / Math.max(data.length - 1, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) { var y = p.t + (gH / 4) * i; ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(W - p.r, y); ctx.stroke(); }
    var gr = ctx.createLinearGradient(0, p.t, 0, H - p.b); gr.addColorStop(0, 'rgba(56,189,248,0.25)'); gr.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.beginPath(); ctx.moveTo(p.l, H - p.b);
    for (var i = 0; i < data.length; i++) ctx.lineTo(p.l + i * xs, p.t + gH - (data[i] / CFG.K) * gH);
    ctx.lineTo(p.l + (data.length - 1) * xs, H - p.b); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
    ctx.beginPath(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    for (var i = 0; i < data.length; i++) { var x = p.l + i * xs, y = p.t + gH - (data[i] / CFG.K) * gH; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
    for (var i = 0; i < data.length; i++) { var x = p.l + i * xs, y = p.t + gH - (data[i] / CFG.K) * gH; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = data[i] < CFG.K * .25 ? '#f87171' : data[i] < CFG.K * .5 ? '#fbbf24' : '#38bdf8'; ctx.fill(); }
    ctx.fillStyle = '#64748b'; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) ctx.fillText(Math.round(CFG.K - (CFG.K / 4) * i), p.l - 5, p.t + (gH / 4) * i + 3);
    ctx.textAlign = 'center'; var st = data.length <= 10 ? 1 : Math.ceil(data.length / 10);
    for (var i = 0; i < data.length; i += st) ctx.fillText(i, p.l + i * xs, H - p.b + 14);
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(248,113,113,0.4)'; var cy = p.t + gH - (CFG.CRIT / CFG.K) * gH;
    ctx.beginPath(); ctx.moveTo(p.l, cy); ctx.lineTo(W - p.r, cy); ctx.stroke();
    ctx.fillStyle = 'rgba(248,113,113,0.5)'; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Critical', p.l + 3, cy - 3);
    ctx.strokeStyle = 'rgba(74,222,128,0.4)'; var my = p.t + gH * 0.5;
    ctx.beginPath(); ctx.moveTo(p.l, my); ctx.lineTo(W - p.r, my); ctx.stroke();
    ctx.fillStyle = 'rgba(74,222,128,0.5)'; ctx.fillText('MSY (K/2)', p.l + 3, my - 3);
    ctx.setLineDash([]);
}

// === CANVAS ===
function setupCanvas() { var c = el('lake'), pr = c.parentElement, w = pr.clientWidth - 56, h = Math.max(200, pr.clientHeight - 20), d = window.devicePixelRatio || 1; c.width = w * d; c.height = h * d; c.style.width = w + 'px'; c.style.height = h + 'px'; initFish(Math.round(S.pop * 0.5)); }
function initFish(n) { var c = el('lake'), W = c.width, H = c.height; fish = []; for (var i = 0; i < n; i++) fish.push({ x: Math.random() * W, y: 40 + Math.random() * (H - 80), vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * .5, sz: 5 + Math.random() * 7, hu: 180 + Math.random() * 40, ph: Math.random() * Math.PI * 2 }); }
function animLake() {
    var c = el('lake'); if (!c) { lakeOn = false; return; } var ctx = c.getContext('2d'), W = c.width, H = c.height; if (W < 10) { requestAnimationFrame(animLake); return; }
    var tgt = Math.round(S.pop * 0.5); while (fish.length < tgt) fish.push({ x: Math.random() * W, y: 40 + Math.random() * (H - 80), vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * .5, sz: 5 + Math.random() * 7, hu: 180 + Math.random() * 40, ph: Math.random() * Math.PI * 2 });
    while (fish.length > tgt) fish.pop();
    ctx.clearRect(0, 0, W, H); var wg = ctx.createLinearGradient(0, 0, 0, H); wg.addColorStop(0, '#0c1929'); wg.addColorStop(.4, '#0f2847'); wg.addColorStop(1, '#0a1e3d'); ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
    var t = Date.now() * .001; ctx.globalAlpha = .03;
    for (var i = 0; i < 4; i++) { var cx = W * .5 + Math.sin(t + i) * W * .3, cy2 = H * .5 + Math.cos(t * .7 + i * 2) * H * .3, r = 50 + Math.sin(t + i) * 20; var cg = ctx.createRadialGradient(cx, cy2, 0, cx, cy2, r); cg.addColorStop(0, 'rgba(56,189,248,1)'); cg.addColorStop(1, 'rgba(56,189,248,0)'); ctx.fillStyle = cg; ctx.fillRect(cx - r, cy2 - r, r * 2, r * 2); }
    ctx.globalAlpha = 1;
    for (var i = 0; i < fish.length; i++) {
        var f = fish[i]; f.x += f.vx; f.y += f.vy + Math.sin(t * 2 + f.ph) * .3;
        if (f.x < -20) f.x = W + 20;
        if (f.x > W + 20) f.x = -20;
        if (f.y < 30) f.vy = Math.abs(f.vy);
        if (f.y > H - 30) f.vy = -Math.abs(f.vy);
        ctx.save(); ctx.translate(f.x, f.y); if (f.vx < 0) ctx.scale(-1, 1);

        // Fish Body
        ctx.beginPath();
        ctx.moveTo(-f.sz * 0.8, 0);
        ctx.quadraticCurveTo(-f.sz * 0.5, -f.sz * 1.0, f.sz * 0.2, -f.sz * 0.9);
        ctx.quadraticCurveTo(f.sz * 1.5, -f.sz * 0.5, f.sz * 1.5, 0);
        ctx.quadraticCurveTo(f.sz * 1.5, f.sz * 0.5, f.sz * 0.2, f.sz * 0.9);
        ctx.quadraticCurveTo(-f.sz * 0.5, f.sz * 1.0, -f.sz * 0.8, 0);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + f.hu + ',75%,60%,1)'; ctx.fill();

        // Tail
        ctx.beginPath();
        ctx.moveTo(-f.sz * 0.7, 0);
        ctx.lineTo(-f.sz * 1.8, -f.sz * 0.8);
        ctx.quadraticCurveTo(-f.sz * 1.4, 0, -f.sz * 1.8, f.sz * 0.8);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + f.hu + ',70%,50%,0.9)'; ctx.fill();

        // Top Fin
        ctx.beginPath();
        ctx.moveTo(-f.sz * 0.2, -f.sz * 0.9);
        ctx.quadraticCurveTo(0, -f.sz * 1.6, f.sz * 0.6, -f.sz * 0.6);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + f.hu + ',70%,50%,0.8)'; ctx.fill();

        // Eye
        ctx.beginPath();
        ctx.arc(f.sz * 0.8, -f.sz * 0.2, f.sz * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'white'; ctx.fill();
        ctx.beginPath();
        ctx.arc(f.sz * 0.9, -f.sz * 0.2, f.sz * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = '#1e293b'; ctx.fill();
        ctx.restore();
    }
    for (var i = ripples.length - 1; i >= 0; i--) { var rp = ripples[i]; rp.radius += .8; rp.alpha -= .008; if (rp.alpha <= 0) { ripples.splice(i, 1); continue; } ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(56,189,248,' + rp.alpha + ')'; ctx.lineWidth = 1; ctx.stroke(); }
    if (Math.random() < .02) ripples.push({ x: Math.random() * W, y: 15 + Math.random() * 30, radius: 2, alpha: .3 });
    ctx.globalAlpha = .06; for (var x = 0; x < W; x += 35) { var sy = 8 + Math.sin(t * 1.5 + x * .02) * 4; ctx.beginPath(); ctx.ellipse(x, sy, 16, 2.5, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); } ctx.globalAlpha = 1;
    requestAnimationFrame(animLake);
}

// === STRATEGY ANALYSIS ===
function classifyStrategy(harvests, cfg, n) {
    if (!harvests || harvests.length === 0) return { type: 'unknown', label: 'Unknown', avg: 0, sd: 0, fairShare: 0 };
    var total = 0, maxH = 0, minH = Infinity;
    var fairShare = Math.round(cfg.K * cfg.R / 4 / n * 10) / 10;
    for (var i = 0; i < harvests.length; i++) { total += harvests[i]; if (harvests[i] > maxH) maxH = harvests[i]; if (harvests[i] < minH) minH = harvests[i]; }
    var avg = total / harvests.length;
    var variance = 0; for (var i = 0; i < harvests.length; i++) variance += (harvests[i] - avg) * (harvests[i] - avg);
    var sd = Math.sqrt(variance / harvests.length);
    if (avg > fairShare * 2) return { type: 'greedy', label: '💰 Over-Harvester', avg: avg, sd: sd, fairShare: fairShare };
    if (avg <= fairShare * 1.1 && sd < 2) return { type: 'sustainable', label: '🌿 Sustainable Fisher', avg: avg, sd: sd, fairShare: fairShare };
    if (sd > avg * 0.6 && harvests.length > 3) return { type: 'erratic', label: '🎲 Erratic Strategist', avg: avg, sd: sd, fairShare: fairShare };
    if (avg < fairShare * 0.6) return { type: 'conservative', label: '🛡️ Ultra-Conservative', avg: avg, sd: sd, fairShare: fairShare };
    return { type: 'balanced', label: '⚖️ Balanced Fisher', avg: avg, sd: sd, fairShare: fairShare };
}

function getReflectionQuestions(stratType, si) {
    var q = {
        greedy: [
            { q: 'Short-Term Gains', d: 'You averaged ' + Math.round(si.avg * 10) / 10 + ' fish/round — well above the sustainable ' + Math.round(si.fairShare * 10) / 10 + '. What drove you to take more?' },
            { q: 'Impact Awareness', d: 'How did your harvesting affect the fish population? When did you notice consequences?' },
            { q: 'Social Dynamics', d: 'Do you think others changed behavior because of your choices? How does one person\'s greed affect the group?' },
            { q: 'Real-World Connection', d: 'Can you think of real situations where individuals exploit shared resources like you did? What happens long-term?' }
        ],
        sustainable: [
            { q: 'Discipline Under Pressure', d: 'You stayed close to the sustainable share (' + Math.round(si.fairShare * 10) / 10 + '). Was it hard to restrain yourself when others took more?' },
            { q: 'Fairness vs. Outcome', d: 'Your strategy was good for the ecosystem but may have earned you less. Was that fair?' },
            { q: 'Trust & Frustration', d: 'How did it feel watching others potentially over-harvest while you were careful?' },
            { q: 'Systemic Thinking', d: 'In real life, sustainable individuals often lose to exploiters. What structures could protect sustainable behavior?' }
        ],
        erratic: [
            { q: 'Decision Patterns', d: 'Your harvest varied significantly (SD: ' + Math.round(si.sd * 10) / 10 + '). What influenced your round-to-round decisions?' },
            { q: 'Information & Reaction', d: 'Were you reacting to population changes or what others did?' },
            { q: 'Consistency Challenge', d: 'Would a more consistent strategy have produced better results?' },
            { q: 'Adaptability', d: 'Is it better to have a fixed plan or adapt constantly? What are the trade-offs?' }
        ],
        conservative: [
            { q: 'Caution vs. Opportunity', d: 'You averaged only ' + Math.round(si.avg * 10) / 10 + ' — below the sustainable limit. Were you concerned about depletion or something else?' },
            { q: 'Missed Earnings', d: 'Your approach left fish but also left money. Were you trying to set an example?' },
            { q: 'Group Responsibility', d: 'Did you feel responsible for the group outcome or were you protecting yourself from risk?' },
            { q: 'Optimal Balance', d: 'Harvesting too little also has a cost — how would you find the right balance in a real scenario?' }
        ],
        balanced: [
            { q: 'Strategic Thinking', d: 'Your average of ' + Math.round(si.avg * 10) / 10 + ' was near the sustainable level. Was this intentional or intuitive?' },
            { q: 'Group Dynamics', d: 'How much did other players\' behavior influence your decisions?' },
            { q: 'Scaling Up', d: 'If this game had 50 players, would your balanced approach still work?' },
            { q: 'Governance Design', d: 'What rules or incentives would you design to encourage others to adopt a balanced approach?' }
        ],
        unknown: [
            { q: 'Goal Reflection', d: 'What was your main goal — maximizing earnings or preserving the resource?' },
            { q: 'Key Moment', d: 'Was there a turning point that changed how you thought about your harvest?' },
            { q: 'Group Trust', d: 'Did you trust others to be responsible? How did that affect your choices?' },
            { q: 'Lessons Learned', d: 'What would you do differently if you played again?' }
        ]
    };
    return q[stratType] || q.unknown;
}

// === END SCREEN ===
function showEnd() {
    lakeOn = false; go('end'); var fp = Math.round(S.pop);
    if (S.dead) { el('eico').textContent = '💀'; el('etit').textContent = 'The Lake Collapsed!'; el('esub').textContent = 'Overfishing destroyed the ecosystem.'; }
    else if (fp > CFG.K * .7) { el('eico').textContent = '🌊'; el('etit').textContent = 'Sustainable Success!'; el('esub').textContent = 'The lake thrived!'; }
    else if (fp > CFG.K * .3) { el('eico').textContent = '⚠️'; el('etit').textContent = 'Barely Surviving'; el('esub').textContent = 'The lake survived but was stressed.'; }
    else { el('eico').textContent = '😰'; el('etit').textContent = 'Near Collapse'; el('esub').textContent = 'Dangerously overexploited.'; }

    // Leaderboard
    var ap = allP.slice().sort(function (a, b) { return b.earn - a.earn; }); var top = ap[0].earn;
    var sh = ''; ap.forEach(function (p, i) {
        sh += '<div class="er"><span class="en">' + (i + 1) + '. ' + p.emoji + ' ' + p.name + ' <span style="color:var(--t3);font-size:.75rem">' + (p.human ? 'Human' : 'AI') + '</span></span><span class="ev' + (p.earn === top ? ' top' : '') + '">$' + p.earn + '</span></div>';
    });
    el('est').innerHTML = sh;
    setTimeout(function () { drawChart(el('ecv'), S.hist); }, 200);

    // === PERSONALIZED SUMMARY ===
    var me = myId ? allP.find(function (p) { return p.id === myId; }) : null;
    var myH = me ? (playerHarvests[myId] || me.harvests || []) : null;
    var n = allP.length;
    var summaryHtml = '';

    if (me && myH && myH.length > 0) {
        var myRank = ap.findIndex(function (p) { return p.id === myId; }) + 1;
        var totalH = 0; for (var i = 0; i < myH.length; i++) totalH += myH[i];
        var avgH = totalH / myH.length;
        var maxH = Math.max.apply(null, myH); var minH = Math.min.apply(null, myH);
        var strat = classifyStrategy(myH, CFG, n);

        summaryHtml += '<div style="background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:14px;padding:20px;margin-bottom:20px">';
        summaryHtml += '<h3 style="margin:0 0 12px;color:var(--ac)">' + me.emoji + ' ' + me.name + ' — Your Performance</h3>';
        summaryHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px">';
        summaryHtml += '<div style="text-align:center;padding:10px;background:rgba(0,0,0,.15);border-radius:10px"><div style="font-size:.75rem;color:var(--t3)">Rank</div><div style="font-size:1.5rem;font-weight:700">#' + myRank + '</div><div style="font-size:.7rem;color:var(--t3)">of ' + n + '</div></div>';
        summaryHtml += '<div style="text-align:center;padding:10px;background:rgba(0,0,0,.15);border-radius:10px"><div style="font-size:.75rem;color:var(--t3)">Total Earned</div><div style="font-size:1.5rem;font-weight:700;color:var(--gn)">$' + me.earn + '</div></div>';
        summaryHtml += '<div style="text-align:center;padding:10px;background:rgba(0,0,0,.15);border-radius:10px"><div style="font-size:.75rem;color:var(--t3)">Avg Harvest</div><div style="font-size:1.5rem;font-weight:700">' + (Math.round(avgH * 10) / 10) + '</div><div style="font-size:.7rem;color:var(--t3)">fish/round</div></div>';
        summaryHtml += '<div style="text-align:center;padding:10px;background:rgba(0,0,0,.15);border-radius:10px"><div style="font-size:.75rem;color:var(--t3)">Range</div><div style="font-size:1.5rem;font-weight:700">' + minH + '–' + maxH + '</div></div>';
        summaryHtml += '</div>';
        var stratColors = { greedy: 'var(--rd)', sustainable: 'var(--gn)', erratic: 'var(--yl)', conservative: 'var(--tl)', balanced: 'var(--ac)', unknown: 'var(--t2)' };
        summaryHtml += '<div style="text-align:center;margin-bottom:12px"><span style="display:inline-block;padding:8px 20px;border-radius:20px;background:rgba(0,0,0,.2);font-weight:700;font-size:1.1rem;color:' + (stratColors[strat.type] || 'var(--t1)') + '">' + strat.label + '</span></div>';
        summaryHtml += '<div style="font-size:.8rem;color:var(--t3);margin-bottom:4px">Your harvest by round:</div>';
        summaryHtml += '<div style="display:flex;align-items:end;gap:3px;height:40px;margin-bottom:8px">';
        var barMax = Math.max.apply(null, myH) || 1;
        for (var i = 0; i < myH.length; i++) {
            var bh = Math.max(2, (myH[i] / barMax) * 36);
            var bc = myH[i] > strat.fairShare * 1.5 ? 'var(--rd)' : myH[i] <= strat.fairShare ? 'var(--gn)' : 'var(--yl)';
            summaryHtml += '<div style="width:' + Math.max(8, Math.floor(100 / myH.length)) + '%;height:' + bh + 'px;background:' + bc + ';border-radius:3px 3px 0 0;opacity:.85" title="R' + (i + 1) + ': ' + myH[i] + '"></div>';
        }
        summaryHtml += '</div></div>';
        var qs = getReflectionQuestions(strat.type, strat);
        summaryHtml += '<div style="margin-bottom:20px"><h3 style="margin:0 0 12px;color:var(--ac)">💭 Reflection Questions — For You</h3>';
        qs.forEach(function (q) { summaryHtml += '<div class="dqi"><strong>' + q.q + '</strong>' + q.d + '</div>'; });
        summaryHtml += '</div>';
    } else if (myRole === 'admin') {
        summaryHtml += '<div style="background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:14px;padding:20px;margin-bottom:20px">';
        summaryHtml += '<h3 style="margin:0 0 12px;color:var(--ac)">📊 Player Strategy Analysis</h3>';
        summaryHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
        allP.forEach(function (p) {
            var h = playerHarvests[p.id] || p.harvests || [];
            var strat = classifyStrategy(h, CFG, n);
            var totalH = 0; for (var i = 0; i < h.length; i++) totalH += h[i];
            var avgH = h.length > 0 ? totalH / h.length : 0;

            var stratText = strat.label;
            var stratColor = 'var(--t2)';
            if (h.length >= 6) {
                var h1 = h.slice(0, Math.floor(h.length / 2));
                var h2 = h.slice(Math.floor(h.length / 2));
                var strat1 = classifyStrategy(h1, CFG, n);
                var strat2 = classifyStrategy(h2, CFG, n);
                if (strat1.type !== strat2.type && strat1.type !== 'unknown' && strat2.type !== 'unknown') {
                    stratText = strat1.label.split(' ')[1] + ' → ' + strat2.label.split(' ')[1];
                    stratColor = 'var(--ac)';
                }
            }

            summaryHtml += '<div style="padding:12px;background:rgba(0,0,0,.15);border-radius:10px">';
            summaryHtml += '<div style="font-weight:700">' + p.emoji + ' ' + p.name + '</div>';
            summaryHtml += '<div style="font-size:.85rem;color:' + stratColor + ';margin:4px 0;font-weight:600">' + stratText + '</div>';
            summaryHtml += '<div style="font-size:.8rem">Avg: ' + (Math.round(avgH * 10) / 10) + ' fish | Earned: $' + p.earn + '</div>';
            summaryHtml += '</div>';
        });
        summaryHtml += '</div></div>';
    }

    var ecfEl = el('ecf');
    var cp = CFG.K, ct = 0;
    for (var r = 0; r < CFG.MR; r++) { var rg = CFG.R * cp * (1 - cp / CFG.K); var h = Math.floor(rg); ct += h * CFG.PRICE; cp = cp + rg - h; }
    var at = 0; allP.forEach(function (p) { at += p.earn; });
    ecfEl.innerHTML = summaryHtml + '<p>If all ' + n + ' players cooperated — harvesting only regrowth:</p><div class="cfc"><div class="cfb a"><div class="cfl">Actual Total</div><div class="cfv">$' + at + '</div></div><div class="cfb i"><div class="cfl">Cooperative Total</div><div class="cfv">$' + ct + '</div></div></div><p style="margin-top:16px">Cooperative scenario earns <strong>$' + Math.max(0, ct - at) + ' more</strong> while keeping the lake healthy.</p>';

    var qs = [
        { q: 'Trust & Cooperation', d: 'Did you trust other players to harvest sustainably? How did not knowing their choices affect yours?' },
        { q: 'Real-World Parallels', d: 'What real-world situations mirror this simulation? (Climate, water, fisheries, etc.)' },
        { q: 'Governance & Solutions', d: 'What rules or agreements could the group have adopted to prevent overexploitation?' },
        { q: 'MSY & Sustainability', d: 'The MSY was ' + Math.round(CFG.K * CFG.R / 4 * 10) / 10 + ' fish/round total. Did the group stay below this?' }
    ];
    var dh = ''; qs.forEach(function (q) { dh += '<div class="dqi"><strong>' + q.q + '</strong>' + q.d + '</div>'; });
    el('edq').innerHTML = dh;
    el('els').innerHTML = '<div class="li2"><div class="ln">1</div><div><strong>Individual rationality ≠ collective rationality.</strong></div></div><div class="li2"><div class="ln">2</div><div><strong>Shared resources need governance.</strong></div></div><div class="li2"><div class="ln">3</div><div><strong>Timing matters.</strong> Depletion may be irreversible.</div></div><div class="li2"><div class="ln">4</div><div><strong>Cooperation is fragile.</strong> One greedy actor undermines all.</div></div><div class="li2"><div class="ln">5</div><div><strong>Elinor Ostrom showed communities can self-govern commons.</strong></div></div>';

    if (myRole === 'admin') {
        var adminEnd = document.createElement('div');
        adminEnd.style.cssText = 'text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--bd)';
        adminEnd.innerHTML = '<button class="btn" onclick="backToRoomDashboard()" style="font-size:1rem;margin-right:12px">📋 Room Dashboard</button>';
        ecfEl.appendChild(adminEnd);
    }
}

window.addEventListener('resize', function () { if (el('sim-scr').classList.contains('active')) setupCanvas(); });

// Reveal admin button if url has ?admin=true
window.addEventListener('DOMContentLoaded', function () {
    if (location.search.includes('admin=true')) {
        var btn = document.getElementById('btn-admin-host');
        if (btn) btn.style.display = 'block';
    }
});
