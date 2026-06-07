// ============================================================
//  8 BALL POOL  –  Complete vanilla-JS implementation
// ============================================================

(function () {
  'use strict';

  // ── Canvas / context ─────────────────────────────────────
  const canvas = document.getElementById('pool-canvas');
  const ctx    = canvas.getContext('2d');

  // ── Constants ────────────────────────────────────────────
  const RAIL_W       = 36;          // rail (cushion) width in canvas px
  const BALL_R       = 11;          // ball radius
  const POCKET_R     = 16;          // pocket visual radius
  const POCKET_GRAB  = 14;          // distance at which ball is pocketed
  const FRICTION     = 0.985;       // per-frame speed multiplier
  const MIN_SPEED    = 0.08;        // speed below which ball stops
  const MAX_POWER    = 18;          // max shot impulse (px/frame)
  const CUE_LENGTH   = 110;
  const CUE_TIP_W    = 4;
  const CUE_BUTT_W   = 11;
  const SPIN_DECAY   = 0.94;

  // Ball colours (1-15 + cue)
  const BALL_COLORS = [
    '#f5f5f5',  // 0  cue
    '#f5c518',  // 1  yellow solid
    '#1a53cc',  // 2  blue solid
    '#cc2200',  // 3  red solid
    '#7b00cc',  // 4  purple solid
    '#cc5500',  // 5  orange solid
    '#008844',  // 6  green solid
    '#990000',  // 7  maroon solid
    '#111111',  // 8  black (eight ball)
    '#f5c518',  // 9  yellow stripe
    '#1a53cc',  // 10 blue stripe
    '#cc2200',  // 11 red stripe
    '#7b00cc',  // 12 purple stripe
    '#cc5500',  // 13 orange stripe
    '#008844',  // 14 green stripe
    '#990000',  // 15 maroon stripe
  ];

  // ── Geometry helpers ─────────────────────────────────────
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function normalize(v) {
    const m = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
    return { x: v.x / m, y: v.y / m };
  }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }

  // ── Game state ────────────────────────────────────────────
  let TABLE_W, TABLE_H;   // playing surface (inside rails)
  let OX, OY;             // canvas offset of the playing surface top-left
  let CW, CH;             // full canvas dimensions

  let balls = [];
  let pockets = [];
  let state = {};         // everything about current game state

  // ── State machine ─────────────────────────────────────────
  // phases: 'aiming' | 'shooting' | 'rolling' | 'placing' | 'gameover'
  function newState() {
    return {
      phase:        'aiming',
      currentPlayer: 0,          // 0 or 1
      playerType:   [null, null], // 'solid'|'stripe' or null
      pocketed:     [[], []],     // balls pocketed by each player
      typesAssigned: false,
      message:      '',
      shotInProgress: false,
      foulThisTurn:   false,
      ballsPocketedThisTurn: [],
      cueBallPocketed: false,
    };
  }

  // ── Ball factory ──────────────────────────────────────────
  function makeBall(id, x, y) {
    return {
      id, x, y,
      vx: 0, vy: 0,
      radius: BALL_R,
      pocketed: false,
      color: BALL_COLORS[id],
      isStripe: id >= 9 && id <= 15,
      isSolid:  id >= 1 && id <= 7,
      isCue:    id === 0,
      isEight:  id === 8,
      // spin (visual only)
      angle: 0,
      spin: 0,
    };
  }

  // ── Table geometry ────────────────────────────────────────
  function calcTableDimensions() {
    const container = document.getElementById('canvas-container');
    const maxW = container.clientWidth  - 8;
    const maxH = container.clientHeight - 8;

    // Standard pool table is 2:1 ratio (playing surface)
    const ratio = 2.0;
    let surfW = maxW - 2 * RAIL_W;
    let surfH = surfW / ratio;

    if (surfH + 2 * RAIL_W > maxH) {
      surfH = maxH - 2 * RAIL_W;
      surfW = surfH * ratio;
    }

    // Round to even px for crisp lines
    surfW = Math.floor(surfW / 2) * 2;
    surfH = Math.floor(surfH / 2) * 2;

    TABLE_W = surfW;
    TABLE_H = surfH;
    CW = surfW + 2 * RAIL_W;
    CH = surfH + 2 * RAIL_W;
    OX = RAIL_W;
    OY = RAIL_W;

    canvas.width  = CW;
    canvas.height = CH;
  }

  // ── Pocket positions ──────────────────────────────────────
  function buildPockets() {
    const cx = OX + TABLE_W / 2;
    // Corner pockets sit right at the corners; side pockets at midpoint of long rails
    pockets = [
      { x: OX,            y: OY,             corner: true  },  // TL
      { x: OX + TABLE_W,  y: OY,             corner: true  },  // TR
      { x: cx,            y: OY - 3,         corner: false },  // TM
      { x: OX,            y: OY + TABLE_H,   corner: true  },  // BL
      { x: OX + TABLE_W,  y: OY + TABLE_H,   corner: true  },  // BR
      { x: cx,            y: OY + TABLE_H + 3, corner: false }, // BM
    ];
  }

  // ── Ball rack ─────────────────────────────────────────────
  function rackBalls() {
    balls = [];
    const spacing = BALL_R * 2 + 0.5;
    const apex_x  = OX + TABLE_W * 0.62;
    const apex_y  = OY + TABLE_H / 2;

    // Standard 5-row triangle rack order
    const rackOrder = [
      [1],
      [2, 9],
      [3, 8, 10],
      [4, 11, 14, 7],
      [6, 13, 12, 15, 5],
    ];

    let idx = 0;
    for (let row = 0; row < rackOrder.length; row++) {
      for (let col = 0; col <= row; col++) {
        const id = rackOrder[row][col];
        const bx = apex_x + row * spacing * Math.cos(Math.PI / 6)
                          + (Math.random() - 0.5) * 0.4;
        const by = apex_y - row * spacing * 0.5
                          + col * spacing
                          + (Math.random() - 0.5) * 0.4;
        balls.push(makeBall(id, bx, by));
        idx++;
      }
    }

    // Cue ball
    const cueBall = makeBall(0, OX + TABLE_W * 0.25, OY + TABLE_H / 2);
    balls.unshift(cueBall);
  }

  // ── Input state ───────────────────────────────────────────
  const mouse = { x: 0, y: 0, down: false, dragStart: null };
  let   aimAngle = 0;
  let   shotPower = 0;   // 0-1
  let   isDragging = false;

  // ── Init ─────────────────────────────────────────────────
  function init() {
    calcTableDimensions();
    buildPockets();
    rackBalls();
    state = newState();
    isDragging = false;
    shotPower = 0;
    updateUI();
    render();
  }

  // ─────────────────────────────────────────────────────────
  //  RENDERING
  // ─────────────────────────────────────────────────────────

  function render() {
    ctx.clearRect(0, 0, CW, CH);
    drawTable();
    drawBalls();
    if (state.phase === 'aiming' || state.phase === 'shooting') {
      drawCue();
    }
    if (state.phase === 'placing') {
      drawPlacementGuide();
    }
    requestAnimationFrame(render);
  }

  // ── Table ─────────────────────────────────────────────────
  function drawTable() {
    // Outer shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = '#3b1f09';
    ctx.fillRect(0, 0, CW, CH);
    ctx.restore();

    // Rail wood background
    const woodGrad = ctx.createLinearGradient(0, 0, CW, CH);
    woodGrad.addColorStop(0,   '#7a4520');
    woodGrad.addColorStop(0.3, '#5c3210');
    woodGrad.addColorStop(0.7, '#4a2808');
    woodGrad.addColorStop(1,   '#3b1f09');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Rail wood grain lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255,200,100,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < CW; i += 18) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 10, CH);
      ctx.stroke();
    }
    ctx.restore();

    // Rail inner bevel (dark line separating rail from felt)
    ctx.strokeStyle = '#1a0a00';
    ctx.lineWidth   = 2;
    ctx.strokeRect(OX - 2, OY - 2, TABLE_W + 4, TABLE_H + 4);

    // Felt surface
    const feltGrad = ctx.createRadialGradient(
      OX + TABLE_W / 2, OY + TABLE_H / 2, TABLE_H * 0.1,
      OX + TABLE_W / 2, OY + TABLE_H / 2, TABLE_W * 0.65
    );
    feltGrad.addColorStop(0,   '#1e6b34');
    feltGrad.addColorStop(0.6, '#1a5c2e');
    feltGrad.addColorStop(1,   '#134820');
    ctx.fillStyle = feltGrad;
    ctx.fillRect(OX, OY, TABLE_W, TABLE_H);

    // Felt subtle texture dots
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let fx = OX; fx < OX + TABLE_W; fx += 6) {
      for (let fy = OY; fy < OY + TABLE_H; fy += 6) {
        if ((fx + fy) % 12 === 0) {
          ctx.beginPath();
          ctx.arc(fx, fy, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Center spot
    ctx.save();
    ctx.beginPath();
    ctx.arc(OX + TABLE_W / 2, OY + TABLE_H / 2, 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Head string (break line)
    const headX = OX + TABLE_W * 0.25;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(headX, OY + 8);
    ctx.lineTo(headX, OY + TABLE_H - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Head spot (cue ball placement dot)
    ctx.save();
    ctx.beginPath();
    ctx.arc(headX, OY + TABLE_H / 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.restore();

    // Draw pocket cutouts in rail first, then pockets
    drawPockets();

    // Rail edge highlight
    ctx.strokeStyle = 'rgba(255,200,100,0.18)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(1, 1, CW - 2, CH - 2);
  }

  function drawPockets() {
    pockets.forEach((p, i) => {
      // Cut out pocket from felt & rail by drawing black circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();
      ctx.restore();

      // Pocket liner (dark gradient)
      const pg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, POCKET_R + 2);
      pg.addColorStop(0,   '#000000');
      pg.addColorStop(0.5, '#111111');
      pg.addColorStop(0.8, '#1a1a1a');
      pg.addColorStop(1,   '#2a1a08');
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.restore();

      // Pocket leather rim
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
      ctx.strokeStyle = '#3d2000';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // Inner gloss ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R - 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,150,50,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  // ── Balls ─────────────────────────────────────────────────
  function drawBalls() {
    balls.forEach(b => {
      if (b.pocketed) return;
      drawSingleBall(b);
    });
  }

  function drawSingleBall(b) {
    ctx.save();

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur  = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;

    if (b.isStripe) {
      drawStripeBall(b);
    } else {
      drawSolidBall(b);
    }

    // Specular highlight
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    const hlGrad = ctx.createRadialGradient(
      b.x - b.radius * 0.3, b.y - b.radius * 0.35, 0.5,
      b.x, b.y, b.radius
    );
    hlGrad.addColorStop(0,   'rgba(255,255,255,0.55)');
    hlGrad.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    hlGrad.addColorStop(1,   'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad;
    ctx.fill();

    ctx.restore();
  }

  function drawSolidBall(b) {
    // Base sphere
    const sphereGrad = ctx.createRadialGradient(
      b.x - b.radius * 0.25, b.y - b.radius * 0.25, b.radius * 0.05,
      b.x, b.y, b.radius * 1.1
    );
    sphereGrad.addColorStop(0,   lightenColor(b.color, 40));
    sphereGrad.addColorStop(0.5, b.color);
    sphereGrad.addColorStop(1,   darkenColor(b.color, 50));

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = sphereGrad;
    ctx.fill();

    // Number circle (white for all except cue and 8)
    if (b.id !== 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = b.id === 8 ? '#ddd' : 'rgba(255,255,255,0.9)';
      ctx.fill();

      ctx.fillStyle = '#111';
      ctx.font = `bold ${b.radius * 0.6}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), b.x, b.y + 0.5);
      ctx.restore();
    }
  }

  function drawStripeBall(b) {
    // White base
    const sphereGrad = ctx.createRadialGradient(
      b.x - b.radius * 0.25, b.y - b.radius * 0.25, b.radius * 0.05,
      b.x, b.y, b.radius * 1.1
    );
    sphereGrad.addColorStop(0,   '#ffffff');
    sphereGrad.addColorStop(0.5, '#e8e8e8');
    sphereGrad.addColorStop(1,   '#b0b0b0');

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = sphereGrad;
    ctx.fill();

    // Colour stripe band (clip to ball circle)
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.translate(-b.x, -b.y);

    const bandHalf = b.radius * 0.55;
    const stripeGrad = ctx.createLinearGradient(0, b.y - bandHalf, 0, b.y + bandHalf);
    stripeGrad.addColorStop(0,    darkenColor(b.color, 30));
    stripeGrad.addColorStop(0.15, b.color);
    stripeGrad.addColorStop(0.5,  lightenColor(b.color, 20));
    stripeGrad.addColorStop(0.85, b.color);
    stripeGrad.addColorStop(1,    darkenColor(b.color, 30));

    ctx.fillStyle = stripeGrad;
    ctx.fillRect(b.x - b.radius, b.y - bandHalf, b.radius * 2, bandHalf * 2);
    ctx.restore();
    ctx.restore();

    // Ball outline
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Number dot
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.font = `bold ${b.radius * 0.58}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), b.x, b.y + 0.5);
    ctx.restore();
  }

  // ── Cue stick ─────────────────────────────────────────────
  function drawCue() {
    const cue = getCueBall();
    if (!cue || cue.pocketed) return;

    const angle  = aimAngle;
    const offset = cue.radius + 4 + (isDragging ? shotPower * 28 : 0);

    // Direction vector away from cue ball
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    // Tip end (nearest to ball)
    const tx = cue.x - dx * offset;
    const ty = cue.y - dy * offset;

    // Butt end
    const bx = tx - dx * CUE_LENGTH;
    const by = ty - dy * CUE_LENGTH;

    ctx.save();

    // Cue shadow
    ctx.shadowColor   = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;

    // Cue shaft gradient
    const cueGrad = ctx.createLinearGradient(tx, ty, bx, by);
    cueGrad.addColorStop(0,    '#f0e0a0');
    cueGrad.addColorStop(0.15, '#d4b870');
    cueGrad.addColorStop(0.4,  '#b8953a');
    cueGrad.addColorStop(0.75, '#c8a045');
    cueGrad.addColorStop(1,    '#8b6020');

    // Perpendicular for width
    const px = -dy;
    const py =  dx;

    // Draw tapered cue as a trapezoid
    ctx.beginPath();
    ctx.moveTo(tx + px * CUE_TIP_W  / 2,    ty + py * CUE_TIP_W  / 2);
    ctx.lineTo(tx - px * CUE_TIP_W  / 2,    ty - py * CUE_TIP_W  / 2);
    ctx.lineTo(bx - px * CUE_BUTT_W / 2,    by - py * CUE_BUTT_W / 2);
    ctx.lineTo(bx + px * CUE_BUTT_W / 2,    by + py * CUE_BUTT_W / 2);
    ctx.closePath();
    ctx.fillStyle = cueGrad;
    ctx.fill();

    // Cue wrap rings
    ctx.shadowBlur = 0;
    const ringPositions = [0.55, 0.65, 0.75];
    ringPositions.forEach(t => {
      const rx = tx + (bx - tx) * t;
      const ry = ty + (by - ty) * t;
      const rw = CUE_TIP_W + (CUE_BUTT_W - CUE_TIP_W) * t;
      ctx.beginPath();
      ctx.moveTo(rx + px * rw / 2, ry + py * rw / 2);
      ctx.lineTo(rx - px * rw / 2, ry - py * rw / 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Tip (blue chalk tip)
    ctx.beginPath();
    ctx.moveTo(tx + px * CUE_TIP_W / 2, ty + py * CUE_TIP_W / 2);
    ctx.lineTo(tx - px * CUE_TIP_W / 2, ty - py * CUE_TIP_W / 2);
    ctx.strokeStyle = '#3a7bd5';
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Aim line (dotted trajectory)
    if (!isDragging) {
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cue.x, cue.y);
      ctx.lineTo(cue.x - dx * 180, cue.y - dy * 180);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // ── Placement guide for ball-in-hand ──────────────────────
  function drawPlacementGuide() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, BALL_R, 0, Math.PI * 2);
    const valid = isValidCuePlacement(mouse.x, mouse.y);
    ctx.strokeStyle = valid ? 'rgba(80,220,80,0.7)' : 'rgba(220,80,80,0.7)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.fillStyle   = valid ? 'rgba(80,220,80,0.15)' : 'rgba(220,80,80,0.15)';
    ctx.fill();
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────
  //  PHYSICS
  // ─────────────────────────────────────────────────────────

  function physicsStep() {
    if (state.phase !== 'rolling') return;

    // Move balls, apply friction
    balls.forEach(b => {
      if (b.pocketed) return;
      b.x  += b.vx;
      b.y  += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      b.spin *= SPIN_DECAY;
      b.angle += b.spin * 0.12;

      const spd = Math.hypot(b.vx, b.vy);
      if (spd < MIN_SPEED) { b.vx = 0; b.vy = 0; b.spin = 0; }
    });

    // Cushion collisions
    balls.forEach(b => {
      if (b.pocketed) return;
      cushionCollision(b);
    });

    // Ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], bb = balls[j];
        if (a.pocketed || bb.pocketed) continue;
        ballCollision(a, bb);
      }
    }

    // Pocket detection
    balls.forEach(b => {
      if (b.pocketed) return;
      checkPocket(b);
    });

    // Check if all balls have stopped
    const moving = balls.some(b => !b.pocketed && (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED));
    if (!moving) {
      endTurn();
    }
  }

  // ── Cushion (wall) collision ──────────────────────────────
  function cushionCollision(b) {
    const left   = OX + b.radius;
    const right  = OX + TABLE_W - b.radius;
    const top    = OY + b.radius;
    const bottom = OY + TABLE_H - b.radius;

    // Check if ball is near a pocket gap – if so, don't reflect
    const nearPocket = pockets.some(p => dist(b, p) < POCKET_R * 1.6);
    if (nearPocket) return;

    if (b.x < left  && b.vx < 0) { b.x = left;   b.vx *= -0.80; b.spin += b.vx * 0.05; }
    if (b.x > right && b.vx > 0) { b.x = right;  b.vx *= -0.80; b.spin += b.vx * 0.05; }
    if (b.y < top   && b.vy < 0) { b.y = top;    b.vy *= -0.80; b.spin += b.vy * 0.05; }
    if (b.y > bottom && b.vy > 0) { b.y = bottom; b.vy *= -0.80; b.spin += b.vy * 0.05; }
  }

  // ── Ball-ball elastic collision ───────────────────────────
  function ballCollision(a, b) {
    const dx   = b.x - a.x;
    const dy   = b.y - a.y;
    const d    = Math.sqrt(dx * dx + dy * dy);
    const minD = a.radius + b.radius;

    if (d >= minD || d < 0.001) return;

    // Separate overlapping balls
    const overlap = (minD - d) / 2;
    const nx = dx / d;
    const ny = dy / d;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;

    // Relative velocity along normal
    const dvx = b.vx - a.vx;
    const dvy = b.vy - a.vy;
    const dvn = dvx * nx + dvy * ny;

    if (dvn >= 0) return;   // already separating

    // Elastic impulse (equal mass)
    const restitution = 0.95;
    const impulse = dvn * restitution;

    a.vx += impulse * nx;
    a.vy += impulse * ny;
    b.vx -= impulse * nx;
    b.vy -= impulse * ny;

    // Transfer some spin
    const tangVel = Math.hypot(dvx - dvn * nx, dvy - dvn * ny);
    a.spin += tangVel * 0.04;
    b.spin -= tangVel * 0.04;
  }

  // ── Pocket detection ──────────────────────────────────────
  function checkPocket(b) {
    pockets.forEach(p => {
      if (dist(b, p) < POCKET_GRAB) {
        pocketBall(b);
      }
    });
  }

  function pocketBall(b) {
    b.pocketed = true;
    b.vx = 0; b.vy = 0;

    state.ballsPocketedThisTurn.push(b.id);

    if (b.isCue) {
      state.cueBallPocketed = true;
      state.foulThisTurn    = true;
    }
  }

  // ─────────────────────────────────────────────────────────
  //  TURN MANAGEMENT
  // ─────────────────────────────────────────────────────────

  function getCueBall() {
    return balls.find(b => b.isCue);
  }

  function shoot(power, angle) {
    const cue = getCueBall();
    if (!cue || cue.pocketed) return;

    const speed = power * MAX_POWER;
    cue.vx = -Math.cos(angle) * speed;
    cue.vy = -Math.sin(angle) * speed;
    cue.spin = speed * 0.15;

    state.phase = 'rolling';
    state.shotInProgress = true;
    state.ballsPocketedThisTurn = [];
    state.cueBallPocketed = false;
    state.foulThisTurn = false;
    updateUI();
  }

  function endTurn() {
    const pocketed = state.ballsPocketedThisTurn.slice();
    const p = state.currentPlayer;
    const other = 1 - p;

    // Did a valid ball go in (non-cue, non-eight in normal play)?
    const validPocketed = pocketed.filter(id => id !== 0 && id !== 8);
    const eightPocketed = pocketed.includes(8);

    // ── Assign types on first valid pocket ───────────────
    if (!state.typesAssigned && validPocketed.length > 0) {
      const firstId = validPocketed[0];
      const isStripe = firstId >= 9;
      state.playerType[p]     = isStripe ? 'stripe' : 'solid';
      state.playerType[other] = isStripe ? 'solid'  : 'stripe';
      state.typesAssigned = true;
    }

    // ── Check 8-ball win / foul conditions ────────────────
    if (eightPocketed) {
      if (state.typesAssigned && isPlayerFinished(p) && !state.foulThisTurn) {
        // Legal 8-ball win
        endGame(p, false);
      } else {
        // Early or foul 8-ball = lose
        endGame(other, true);
      }
      return;
    }

    // ── Cue-ball scratch ─────────────────────────────────
    if (state.cueBallPocketed) {
      state.foulThisTurn = true;
      setMessage('SCRATCH! Ball in hand for opponent.');
      state.currentPlayer = other;
      respawnCueBall();
      state.phase = 'placing';
      updateUI();
      return;
    }

    // ── Did current player pocket their balls? ────────────
    const myType = state.playerType[p];
    const myBallsIn = myType
      ? validPocketed.filter(id => isBallType(id, myType))
      : validPocketed;

    if (myBallsIn.length > 0 && !state.foulThisTurn) {
      // Continue turn
      addBallsToScore(p, myBallsIn);
      setMessage('Good pot! Shoot again.');
      state.phase = 'aiming';
      updateUI();
    } else {
      // Add any legal balls to score anyway
      if (myBallsIn.length > 0) addBallsToScore(p, myBallsIn);
      // Switch player
      setMessage('');
      state.currentPlayer = other;
      state.phase = 'aiming';
      updateUI();
    }
  }

  function isBallType(id, type) {
    if (type === 'solid')  return id >= 1 && id <= 7;
    if (type === 'stripe') return id >= 9 && id <= 15;
    return false;
  }

  function addBallsToScore(p, ids) {
    ids.forEach(id => {
      if (!state.pocketed[p].includes(id)) {
        state.pocketed[p].push(id);
      }
    });
  }

  function isPlayerFinished(p) {
    const myType = state.playerType[p];
    if (!myType) return false;
    const myRange = myType === 'solid' ? [1, 7] : [9, 15];
    for (let id = myRange[0]; id <= myRange[1]; id++) {
      const b = balls.find(b => b.id === id);
      if (b && !b.pocketed) return false;
    }
    return true;
  }

  function endGame(winnerIdx, wasFoul) {
    state.phase = 'gameover';
    const msg = wasFoul
      ? `Player ${winnerIdx + 1} wins! (Opponent fouled on 8-ball)`
      : `Player ${winnerIdx + 1} wins! 🎱`;
    showWinOverlay(msg);
  }

  function respawnCueBall() {
    let cue = getCueBall();
    if (!cue) {
      cue = makeBall(0, 0, 0);
      balls.unshift(cue);
    }
    cue.pocketed = false;
    cue.vx = 0; cue.vy = 0;
    // Place on opposite half from rack
    cue.x = OX + TABLE_W * 0.22;
    cue.y = OY + TABLE_H / 2;
  }

  function isValidCuePlacement(x, y) {
    // Must be on the felt
    if (x < OX + BALL_R || x > OX + TABLE_W - BALL_R) return false;
    if (y < OY + BALL_R || y > OY + TABLE_H - BALL_R) return false;
    // Must not overlap other balls
    for (const b of balls) {
      if (b.isCue || b.pocketed) continue;
      if (dist({ x, y }, b) < BALL_R * 2 + 2) return false;
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────
  //  UI
  // ─────────────────────────────────────────────────────────

  function updateUI() {
    const p = state.currentPlayer;
    document.getElementById('turn-text').textContent =
      `PLAYER ${p + 1}'s TURN`;

    document.getElementById('panel-p1').classList.toggle('active', p === 0);
    document.getElementById('panel-p2').classList.toggle('active', p === 1);

    const typeLabels = { solid: '● SOLIDS', stripe: '◑ STRIPES', null: '—' };
    document.getElementById('p1-type').textContent = typeLabels[state.playerType[0]] ?? '—';
    document.getElementById('p2-type').textContent = typeLabels[state.playerType[1]] ?? '—';

    renderMiniBalls(0);
    renderMiniBalls(1);
  }

  function renderMiniBalls(p) {
    const container = document.getElementById(`p${p + 1}-balls`);
    container.innerHTML = '';
    state.pocketed[p].forEach(id => {
      const el = document.createElement('span');
      el.className = 'mini-ball';
      el.style.background = BALL_COLORS[id] || '#888';
      if (id >= 9 && id <= 15) {
        el.style.background = `linear-gradient(180deg, #e8e8e8 30%, ${BALL_COLORS[id]} 30%, ${BALL_COLORS[id]} 70%, #e8e8e8 70%)`;
      }
      container.appendChild(el);
    });
  }

  function setPowerUI(pct) {
    const fill = document.getElementById('power-fill');
    const label = document.getElementById('power-pct');
    fill.style.width = (pct * 100).toFixed(0) + '%';
    label.textContent = (pct * 100).toFixed(0) + '%';
  }

  function setMessage(msg) {
    state.message = msg;
    const el = document.getElementById('message-box');
    el.textContent = msg;
  }

  function showWinOverlay(msg) {
    document.getElementById('win-message').textContent = msg;
    document.getElementById('win-overlay').classList.remove('hidden');
  }

  function hideWinOverlay() {
    document.getElementById('win-overlay').classList.add('hidden');
  }

  // ─────────────────────────────────────────────────────────
  //  INPUT HANDLING
  // ─────────────────────────────────────────────────────────

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left)  * scaleX,
      y: (src.clientY - rect.top)   * scaleY,
    };
  }

  canvas.addEventListener('mousemove', e => {
    const pos = getCanvasPos(e);
    mouse.x = pos.x;
    mouse.y = pos.y;

    const cue = getCueBall();
    if (!cue || cue.pocketed) return;

    if (state.phase === 'aiming' || state.phase === 'shooting') {
      aimAngle = Math.atan2(pos.y - cue.y, pos.x - cue.x);
    }

    if (isDragging && mouse.dragStart) {
      const d = dist(pos, mouse.dragStart);
      shotPower = Math.min(d / 120, 1);
      setPowerUI(shotPower);
    }
  });

  canvas.addEventListener('mousedown', e => {
    if (state.phase === 'placing') {
      const pos = getCanvasPos(e);
      if (isValidCuePlacement(pos.x, pos.y)) {
        placeCueBall(pos.x, pos.y);
      }
      return;
    }
    if (state.phase !== 'aiming') return;
    const pos = getCanvasPos(e);
    mouse.dragStart = pos;
    isDragging = true;
    shotPower = 0;
    setPowerUI(0);
  });

  canvas.addEventListener('mouseup', e => {
    if (!isDragging) return;
    isDragging = false;
    if (state.phase !== 'aiming') return;
    if (shotPower > 0.02) {
      shoot(shotPower, aimAngle);
    }
    shotPower = 0;
    setPowerUI(0);
    mouse.dragStart = null;
  });

  canvas.addEventListener('mouseleave', () => {
    if (isDragging) {
      isDragging = false;
      shotPower = 0;
      setPowerUI(0);
      mouse.dragStart = null;
    }
  });

  // Touch support
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    mouse.x = pos.x; mouse.y = pos.y;

    if (state.phase === 'placing') {
      if (isValidCuePlacement(pos.x, pos.y)) placeCueBall(pos.x, pos.y);
      return;
    }
    if (state.phase !== 'aiming') return;
    mouse.dragStart = pos;
    isDragging = true;
    shotPower = 0;
    setPowerUI(0);
    const cue = getCueBall();
    if (cue) aimAngle = Math.atan2(pos.y - cue.y, pos.x - cue.x);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    mouse.x = pos.x; mouse.y = pos.y;
    const cue = getCueBall();
    if (cue) aimAngle = Math.atan2(pos.y - cue.y, pos.x - cue.x);
    if (isDragging && mouse.dragStart) {
      const d = dist(pos, mouse.dragStart);
      shotPower = Math.min(d / 100, 1);
      setPowerUI(shotPower);
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (!isDragging) return;
    isDragging = false;
    if (state.phase === 'aiming' && shotPower > 0.02) {
      shoot(shotPower, aimAngle);
    }
    shotPower = 0;
    setPowerUI(0);
    mouse.dragStart = null;
  }, { passive: false });

  function placeCueBall(x, y) {
    const cue = getCueBall();
    if (!cue) return;
    cue.x = x; cue.y = y;
    cue.pocketed = false;
    cue.vx = 0; cue.vy = 0;
    state.phase = 'aiming';
    setMessage('');
    updateUI();
  }

  // Restart buttons
  document.getElementById('restart-btn').addEventListener('click', () => {
    hideWinOverlay();
    init();
  });
  document.getElementById('win-restart-btn').addEventListener('click', () => {
    hideWinOverlay();
    init();
  });

  // ─────────────────────────────────────────────────────────
  //  COLOUR HELPERS
  // ─────────────────────────────────────────────────────────

  function lightenColor(hex, amt) {
    return shiftColor(hex, amt);
  }
  function darkenColor(hex, amt) {
    return shiftColor(hex, -amt);
  }
  function shiftColor(hex, amt) {
    // parse #rrggbb or #rgb
    let r, g, b;
    const h = hex.replace('#', '');
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.substring(0, 2), 16);
      g = parseInt(h.substring(2, 4), 16);
      b = parseInt(h.substring(4, 6), 16);
    }
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return `rgb(${r},${g},${b})`;
  }

  // ─────────────────────────────────────────────────────────
  //  MAIN LOOP
  // ─────────────────────────────────────────────────────────

  let lastTime = 0;
  const STEP_MS = 1000 / 120;  // 120 physics steps/sec

  function loop(ts) {
    const dt = ts - lastTime;
    if (dt >= STEP_MS) {
      lastTime = ts;
      physicsStep();
    }
    requestAnimationFrame(loop);
  }

  // ─────────────────────────────────────────────────────────
  //  RESIZE
  // ─────────────────────────────────────────────────────────

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      init();
    }, 200);
  });

  // ─────────────────────────────────────────────────────────
  //  START
  // ─────────────────────────────────────────────────────────

  init();
  requestAnimationFrame(loop);

})();
