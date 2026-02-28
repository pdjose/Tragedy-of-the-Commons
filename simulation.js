/* ===== Tragedy of the Commons — Simulation Engine ===== */
(function () {
    'use strict';

    const MAX_ROUNDS = 20;
    const CARRYING_CAPACITY = 100;
    const GROWTH_RATE = 0.3;
    const FISH_PRICE = 3;
    const CRITICAL_THRESHOLD = 10;

    const VILLAGERS = [
        { id: 'sara', name: 'Sara', emoji: '🌿', strategy: 'Sustainable', color: '#4ade80', totalEarnings: 0, lastHarvest: 0 },
        { id: 'gus', name: 'Gus', emoji: '💰', strategy: 'Greedy', color: '#fbbf24', totalEarnings: 0, lastHarvest: 0 },
        { id: 'cora', name: 'Cora', emoji: '🪞', strategy: 'Copycat', color: '#a78bfa', totalEarnings: 0, lastHarvest: 0 },
        { id: 'alex', name: 'Alex', emoji: '🧠', strategy: 'Adaptive', color: '#38bdf8', totalEarnings: 0, lastHarvest: 0 },
    ];

    let state = {
        round: 1, population: CARRYING_CAPACITY,
        popHistory: [CARRYING_CAPACITY], playerEarnings: 0,
        playerLastHarvest: 0, playerHarvestHistory: [],
        gameOver: false, collapsed: false,
    };

    const $ = function (id) { return document.getElementById(id); };
    let fishSprites = [];
    let ripples = [];
    let animFrame = null;
    let lakeRunning = false;

    function showScreen(name) {
        document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
        $(name + '-screen').classList.add('active');
    }

    function init() {
        $('btn-start').onclick = startGame;
        $('btn-restart').onclick = restartGame;
        $('btn-play-again').onclick = restartGame;
        $('harvest-slider').oninput = updateSliderDisplay;
        $('btn-harvest').onclick = playRound;
        $('btn-edu-toggle').onclick = function () { $('edu-sidebar').classList.toggle('open'); };
        $('btn-edu-close').onclick = function () { $('edu-sidebar').classList.remove('open'); };

        var tabs = document.querySelectorAll('.edu-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].onclick = (function (tab) {
                return function () {
                    document.querySelectorAll('.edu-tab').forEach(function (t) { t.classList.remove('active'); });
                    document.querySelectorAll('.edu-pane').forEach(function (p) { p.classList.remove('active'); });
                    tab.classList.add('active');
                    document.getElementById('pane-' + tab.getAttribute('data-tab')).classList.add('active');
                };
            })(tabs[i]);
        }

        renderVillagerCards();
        updateSliderDisplay();
    }

    function startGame() {
        showScreen('sim');
        resetState();
        // Wait a frame for layout to resolve, then init canvas
        requestAnimationFrame(function () {
            setupCanvas();
            updateUI();
            if (!lakeRunning) { lakeRunning = true; animateLake(); }
        });
    }

    function restartGame() {
        resetState();
        showScreen('sim');
        $('round-log').innerHTML = '<div class="log-empty">Play a round to see results here.</div>';
        requestAnimationFrame(function () {
            setupCanvas();
            updateUI();
            if (!lakeRunning) { lakeRunning = true; animateLake(); }
        });
    }

    function resetState() {
        state = {
            round: 1, population: CARRYING_CAPACITY,
            popHistory: [CARRYING_CAPACITY], playerEarnings: 0,
            playerLastHarvest: 0, playerHarvestHistory: [],
            gameOver: false, collapsed: false,
        };
        VILLAGERS.forEach(function (v) { v.totalEarnings = 0; v.lastHarvest = 0; });
        $('harvest-slider').value = 5;
        updateSliderDisplay();
        $('btn-harvest').disabled = false;
        fishSprites = [];
        ripples = [];
    }

    function setupCanvas() {
        var canvas = $('lake-canvas');
        var parent = canvas.parentElement;
        var w = parent.clientWidth - 32;
        var h = Math.max(300, parent.clientHeight - 80);
        var dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        initFishSprites(Math.round(state.population * 0.6));
    }

    function updateSliderDisplay() {
        var v = $('harvest-slider').value;
        $('slider-value').textContent = v + ' fish';
    }

    // --- AI ---
    function aiHarvest(villager) {
        var pop = state.population;
        var regrowth = GROWTH_RATE * pop * (1 - pop / CARRYING_CAPACITY);
        var fairShare = Math.max(0, regrowth / 5);
        switch (villager.strategy) {
            case 'Sustainable':
                return Math.min(Math.round(fairShare), Math.floor(pop / 5));
            case 'Greedy':
                return Math.min(Math.floor(pop * 0.3), 18 + Math.floor(Math.random() * 3));
            case 'Copycat':
                return state.round === 1 ? Math.round(fairShare) : state.playerLastHarvest;
            case 'Adaptive':
                var ratio = pop / CARRYING_CAPACITY;
                if (ratio > 0.7) return Math.min(Math.round(fairShare * 1.5), 15);
                if (ratio > 0.3) return Math.round(fairShare);
                return Math.max(0, Math.round(fairShare * 0.5));
            default: return 0;
        }
    }

    // --- Play Round ---
    function playRound() {
        if (state.gameOver) return;

        var playerHarvest = Math.min(parseInt($('harvest-slider').value), Math.floor(state.population));
        state.playerLastHarvest = playerHarvest;
        state.playerHarvestHistory.push(playerHarvest);

        var totalHarvest = playerHarvest;
        state.playerEarnings += playerHarvest * FISH_PRICE;

        var roundHarvests = [{ name: '🧑 You', harvest: playerHarvest }];

        VILLAGERS.forEach(function (v) {
            var h = aiHarvest(v);
            h = Math.min(h, Math.max(0, Math.floor(state.population - totalHarvest)));
            v.lastHarvest = h;
            v.totalEarnings += h * FISH_PRICE;
            totalHarvest += h;
            roundHarvests.push({ name: v.emoji + ' ' + v.name, harvest: h });
        });

        state.population = Math.max(0, state.population - totalHarvest);

        var regrowth = 0;
        if (state.population > CRITICAL_THRESHOLD) {
            regrowth = GROWTH_RATE * state.population * (1 - state.population / CARRYING_CAPACITY);
            state.population = Math.min(CARRYING_CAPACITY, state.population + regrowth);
        } else if (state.population > 0) {
            regrowth = state.population * 0.05;
            state.population += regrowth;
        }

        state.population = Math.round(state.population * 100) / 100;
        state.popHistory.push(Math.round(state.population));

        if (state.population < 1) { state.population = 0; state.collapsed = true; }

        addLogEntry(state.round, roundHarvests, totalHarvest, Math.round(regrowth));

        state.round++;
        if (state.round > MAX_ROUNDS || state.collapsed) {
            state.gameOver = true;
            $('btn-harvest').disabled = true;
            setTimeout(showEndScreen, 800);
        }

        updateUI();
    }

    // --- UI Update ---
    function updateUI() {
        $('round-num').textContent = Math.min(state.round, MAX_ROUNDS);
        $('stat-population').textContent = Math.round(state.population);
        $('stat-earnings').textContent = '$' + state.playerEarnings;

        var healthPct = (state.population / CARRYING_CAPACITY) * 100;
        var hf = $('health-fill');
        hf.style.width = healthPct + '%';
        hf.className = 'health-fill' + (healthPct < 25 ? ' danger' : healthPct < 50 ? ' warning' : '');
        $('health-value').textContent = Math.round(healthPct) + '%';

        if (state.popHistory.length > 1) {
            var diff = state.popHistory[state.popHistory.length - 1] - state.popHistory[state.popHistory.length - 2];
            var el = $('stat-pop-change');
            el.textContent = (diff >= 0 ? '+' : '') + Math.round(diff) + ' this round';
            el.className = 'stat-sub ' + (diff >= 0 ? 'stat-change-up' : 'stat-change-down');
        }

        if (state.round > 1) {
            var lr = state.popHistory[state.popHistory.length - 1] - state.popHistory[state.popHistory.length - 2];
            $('stat-regrowth').textContent = (lr >= 0 ? '+' : '') + Math.round(lr);
        } else {
            $('stat-regrowth').textContent = '—';
        }

        VILLAGERS.forEach(function (v) {
            var card = document.getElementById('villager-' + v.id);
            if (card) {
                card.querySelector('.villager-harvest').textContent = 'Last: ' + v.lastHarvest;
                card.querySelector('.villager-total').textContent = '$' + v.totalEarnings;
            }
        });

        drawChart($('chart-canvas'), state.popHistory);
    }

    // --- Villager Cards ---
    function renderVillagerCards() {
        var html = '';
        VILLAGERS.forEach(function (v) {
            html += '<div class="villager-card" id="villager-' + v.id + '">' +
                '<div class="villager-name"><span class="villager-emoji">' + v.emoji + '</span>' + v.name + '</div>' +
                '<div class="villager-strategy">' + v.strategy + '</div>' +
                '<div class="villager-stats">' +
                '<span class="villager-harvest">Last: 0</span>' +
                '<span class="villager-total">$0</span>' +
                '</div></div>';
        });
        $('villagers-grid').innerHTML = html;
    }

    // --- Log ---
    function addLogEntry(round, harvests, total, regrowth) {
        var log = $('round-log');
        if (log.querySelector('.log-empty')) log.innerHTML = '';
        var details = harvests.map(function (h) { return h.name + ': ' + h.harvest; }).join(' · ');
        var entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = '<div class="log-round">Round ' + round + ' — Total harvested: ' + total + '</div>' +
            '<div class="log-detail">' + details + ' | Regrowth: +' + regrowth + '</div>';
        log.insertBefore(entry, log.firstChild);
    }

    // --- Chart ---
    function drawChart(canvas, data) {
        if (!canvas || !canvas.getContext) return;
        var rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        var W = rect.width, H = rect.height;
        ctx.clearRect(0, 0, W, H);

        if (data.length < 2) return;

        var pad = { top: 10, right: 10, bottom: 26, left: 36 };
        var gW = W - pad.left - pad.right, gH = H - pad.top - pad.bottom;
        var maxVal = CARRYING_CAPACITY;
        var xStep = gW / Math.max(data.length - 1, 1);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 4; i++) {
            var gy = pad.top + (gH / 4) * i;
            ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
        }

        // Area
        var gradient = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
        gradient.addColorStop(0, 'rgba(56,189,248,0.25)');
        gradient.addColorStop(1, 'rgba(56,189,248,0)');
        ctx.beginPath();
        ctx.moveTo(pad.left, H - pad.bottom);
        for (var i = 0; i < data.length; i++) {
            var x = pad.left + i * xStep;
            var y = pad.top + gH - (data[i] / maxVal) * gH;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(pad.left + (data.length - 1) * xStep, H - pad.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        for (var i = 0; i < data.length; i++) {
            var x = pad.left + i * xStep;
            var y = pad.top + gH - (data[i] / maxVal) * gH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Dots
        for (var i = 0; i < data.length; i++) {
            var x = pad.left + i * xStep;
            var y = pad.top + gH - (data[i] / maxVal) * gH;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = data[i] < 25 ? '#f87171' : data[i] < 50 ? '#fbbf24' : '#38bdf8';
            ctx.fill();
        }

        // Y labels
        ctx.fillStyle = '#64748b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        for (var i = 0; i <= 4; i++) {
            var val = Math.round(maxVal - (maxVal / 4) * i);
            var ly = pad.top + (gH / 4) * i + 3;
            ctx.fillText(val, pad.left - 6, ly);
        }

        // X labels
        ctx.textAlign = 'center';
        var step = data.length <= 10 ? 1 : Math.ceil(data.length / 10);
        for (var i = 0; i < data.length; i += step) {
            ctx.fillText(i, pad.left + i * xStep, H - pad.bottom + 16);
        }

        // Critical threshold line
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(248,113,113,0.4)';
        ctx.lineWidth = 1;
        var cy = pad.top + gH - (CRITICAL_THRESHOLD / maxVal) * gH;
        ctx.beginPath(); ctx.moveTo(pad.left, cy); ctx.lineTo(W - pad.right, cy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(248,113,113,0.5)';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Critical', pad.left + 4, cy - 4);
    }

    // --- Lake Canvas ---
    function initFishSprites(count) {
        var canvas = $('lake-canvas');
        var W = canvas.width, H = canvas.height;
        fishSprites = [];
        for (var i = 0; i < count; i++) {
            fishSprites.push({
                x: Math.random() * W, y: 60 + Math.random() * (H - 120),
                vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 0.5,
                size: 6 + Math.random() * 8, hue: 180 + Math.random() * 40,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    function animateLake() {
        var canvas = $('lake-canvas');
        if (!canvas) { lakeRunning = false; return; }
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;

        if (W === 0 || H === 0) { animFrame = requestAnimationFrame(animateLake); return; }

        // Adjust fish count to match population
        var target = Math.round(state.population * 0.6);
        while (fishSprites.length < target) {
            fishSprites.push({
                x: Math.random() * W, y: 60 + Math.random() * (H - 120),
                vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 0.5,
                size: 6 + Math.random() * 8, hue: 180 + Math.random() * 40,
                phase: Math.random() * Math.PI * 2
            });
        }
        while (fishSprites.length > target) fishSprites.pop();

        ctx.clearRect(0, 0, W, H);

        // Water
        var waterGrad = ctx.createLinearGradient(0, 0, 0, H);
        waterGrad.addColorStop(0, '#0c1929');
        waterGrad.addColorStop(0.4, '#0f2847');
        waterGrad.addColorStop(1, '#0a1e3d');
        ctx.fillStyle = waterGrad;
        ctx.fillRect(0, 0, W, H);

        // Caustics
        var t = Date.now() * 0.001;
        ctx.globalAlpha = 0.03;
        for (var i = 0; i < 6; i++) {
            var cx = W * 0.5 + Math.sin(t + i) * W * 0.3;
            var cy2 = H * 0.5 + Math.cos(t * 0.7 + i * 2) * H * 0.3;
            var r = 60 + Math.sin(t + i) * 30;
            var cg = ctx.createRadialGradient(cx, cy2, 0, cx, cy2, r);
            cg.addColorStop(0, 'rgba(56,189,248,1)');
            cg.addColorStop(1, 'rgba(56,189,248,0)');
            ctx.fillStyle = cg;
            ctx.fillRect(cx - r, cy2 - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;

        // Fish
        for (var fi = 0; fi < fishSprites.length; fi++) {
            var f = fishSprites[fi];
            f.x += f.vx;
            f.y += f.vy + Math.sin(t * 2 + f.phase) * 0.3;
            if (f.x < -20) f.x = W + 20;
            if (f.x > W + 20) f.x = -20;
            if (f.y < 40) f.vy = Math.abs(f.vy);
            if (f.y > H - 40) f.vy = -Math.abs(f.vy);

            ctx.save();
            ctx.translate(f.x, f.y);
            if (f.vx < 0) ctx.scale(-1, 1);

            ctx.beginPath();
            ctx.ellipse(0, 0, f.size, f.size * 0.45, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'hsla(' + f.hue + ', 70%, 60%, 0.8)';
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-f.size * 0.8, 0);
            ctx.lineTo(-f.size * 1.4, -f.size * 0.4);
            ctx.lineTo(-f.size * 1.4, f.size * 0.4);
            ctx.closePath();
            ctx.fillStyle = 'hsla(' + f.hue + ', 60%, 50%, 0.7)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(f.size * 0.4, -f.size * 0.1, f.size * 0.12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fill();
            ctx.restore();
        }

        // Ripples
        for (var ri = ripples.length - 1; ri >= 0; ri--) {
            var rp = ripples[ri];
            rp.radius += 0.8;
            rp.alpha -= 0.008;
            if (rp.alpha <= 0) { ripples.splice(ri, 1); continue; }
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(56,189,248,' + rp.alpha + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        if (Math.random() < 0.02) {
            ripples.push({ x: Math.random() * W, y: 20 + Math.random() * 40, radius: 2, alpha: 0.3 });
        }

        // Shimmer
        ctx.globalAlpha = 0.06;
        for (var sx = 0; sx < W; sx += 40) {
            var sy = 10 + Math.sin(t * 1.5 + sx * 0.02) * 5;
            ctx.beginPath();
            ctx.ellipse(sx, sy, 20, 3, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Boats
        var players = [{ emoji: '🧑', name: 'You', color: '#38bdf8' }];
        VILLAGERS.forEach(function (v) { players.push({ emoji: v.emoji, name: v.name, color: v.color }); });
        var spacing = W / (players.length + 1);
        for (var pi = 0; pi < players.length; pi++) {
            var p = players[pi];
            var bx = spacing * (pi + 1);
            var by = H - 25;
            ctx.beginPath();
            ctx.moveTo(bx - 18, by);
            ctx.quadraticCurveTo(bx, by + 10, bx + 18, by);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.emoji, bx, by - 4);
            ctx.font = '9px Inter, sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(p.name, bx, by + 22);
        }

        animFrame = requestAnimationFrame(animateLake);
    }

    // --- End Screen ---
    function showEndScreen() {
        lakeRunning = false;
        if (animFrame) cancelAnimationFrame(animFrame);
        showScreen('end');

        var finalPop = Math.round(state.population);
        if (state.collapsed) {
            $('end-icon').textContent = '💀';
            $('end-title').textContent = 'The Lake Collapsed!';
            $('end-subtitle').textContent = 'Overfishing destroyed the ecosystem. This is the Tragedy of the Commons in action.';
        } else if (finalPop > 70) {
            $('end-icon').textContent = '🌊';
            $('end-title').textContent = 'Sustainable Success!';
            $('end-subtitle').textContent = 'The lake thrived! Careful harvesting preserved the resource for everyone.';
        } else if (finalPop > 30) {
            $('end-icon').textContent = '⚠️';
            $('end-title').textContent = 'Barely Surviving';
            $('end-subtitle').textContent = 'The lake survived, but it was heavily stressed. A little more greed would have doomed it.';
        } else {
            $('end-icon').textContent = '😰';
            $('end-title').textContent = 'Near Collapse';
            $('end-subtitle').textContent = 'The lake barely survived. The resource was dangerously overexploited.';
        }

        // Stats table
        var allPlayers = [{ name: '🧑 You', earnings: state.playerEarnings }];
        VILLAGERS.forEach(function (v) {
            allPlayers.push({ name: v.emoji + ' ' + v.name + ' (' + v.strategy + ')', earnings: v.totalEarnings });
        });
        allPlayers.sort(function (a, b) { return b.earnings - a.earnings; });

        var topE = allPlayers[0].earnings;
        var statsHtml = '';
        allPlayers.forEach(function (p) {
            statsHtml += '<div class="end-stat-row"><span class="end-stat-name">' + p.name +
                '</span><span class="end-stat-val' + (p.earnings === topE ? ' top' : '') + '">$' + p.earnings + '</span></div>';
        });
        $('end-stats').innerHTML = statsHtml;

        // End chart
        setTimeout(function () { drawChart($('end-chart-canvas'), state.popHistory); }, 200);

        // Cooperative counterfactual
        var coopPop = CARRYING_CAPACITY, coopTotal = 0;
        for (var r = 0; r < MAX_ROUNDS; r++) {
            var rg = GROWTH_RATE * coopPop * (1 - coopPop / CARRYING_CAPACITY);
            var h = Math.floor(rg);
            coopTotal += h * FISH_PRICE;
            coopPop = coopPop + rg - h;
        }
        var actualTotal = state.playerEarnings;
        VILLAGERS.forEach(function (v) { actualTotal += v.totalEarnings; });

        $('counterfactual').innerHTML =
            '<p>If all five villagers had cooperated — harvesting only the natural regrowth each round — here\'s how the outcomes would compare:</p>' +
            '<div class="cf-compare">' +
            '<div class="cf-box actual"><div class="cf-label">Actual Total Earnings</div><div class="cf-value">$' + actualTotal + '</div></div>' +
            '<div class="cf-box ideal"><div class="cf-label">Cooperative Earnings</div><div class="cf-value">$' + coopTotal + '</div></div>' +
            '</div>' +
            '<p style="margin-top:16px">The cooperative scenario earns <strong>$' + Math.max(0, coopTotal - actualTotal) + ' more</strong> in total, ' +
            'while keeping the lake at full health. The tragedy is that <em>individual incentives</em> push against this optimal outcome.</p>';

        // Lessons
        $('lessons').innerHTML =
            '<div class="lesson-item"><div class="lesson-num">1</div><div><strong>Individual rationality ≠ collective rationality.</strong> What makes sense for one person can be disastrous when everyone does it.</div></div>' +
            '<div class="lesson-item"><div class="lesson-num">2</div><div><strong>Shared resources need governance.</strong> Without rules, quotas, or social norms, commons tend to be overexploited.</div></div>' +
            '<div class="lesson-item"><div class="lesson-num">3</div><div><strong>Timing matters.</strong> By the time depletion becomes obvious, it may be too late for the resource to recover.</div></div>' +
            '<div class="lesson-item"><div class="lesson-num">4</div><div><strong>Cooperation is fragile.</strong> Even one greedy actor can undermine a cooperative equilibrium, tempting others to defect.</div></div>' +
            '<div class="lesson-item"><div class="lesson-num">5</div><div><strong>Elinor Ostrom showed another way.</strong> Communities can self-govern commons through trust, communication, and graduated sanctions — without top-down control.</div></div>';
    }

    // --- Window resize handler ---
    window.addEventListener('resize', function () {
        if ($('sim-screen').classList.contains('active')) {
            setupCanvas();
        }
    });

    // --- Start ---
    init();
})();
