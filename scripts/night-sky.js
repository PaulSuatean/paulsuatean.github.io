(function () {
  if (!document.body) return;
  if (!document.body.hasAttribute('data-ambient-enabled')) return;

  const layers = [
    {
      className: 'night-sky__layer layer-1',
      depth: 0.08,
      density: 0.00011,
      size: [0.65, 1.7],
      alpha: [0.55, 0.92],
      glowChance: 0.09,
      sparkleChance: 0.05,
      colors: [
        [255, 255, 255],
        [189, 220, 255],
        [255, 234, 196]
      ],
      drawGalaxy: true
    },
    {
      className: 'night-sky__layer layer-2',
      depth: 0.2,
      density: 0.00007,
      size: [0.8, 1.85],
      alpha: [0.34, 0.72],
      glowChance: 0.06,
      sparkleChance: 0.03,
      colors: [
        [245, 248, 255],
        [160, 205, 255],
        [215, 187, 255]
      ]
    },
    {
      className: 'night-sky__layer layer-3',
      depth: 0.34,
      density: 0.00005,
      size: [0.95, 2.1],
      alpha: [0.24, 0.58],
      glowChance: 0.03,
      sparkleChance: 0.02,
      colors: [
        [255, 255, 255],
        [170, 214, 255],
        [255, 242, 214]
      ]
    }
  ];

  function randomBetween(random, min, max) {
    return min + random() * (max - min);
  }

  function colorWithAlpha(rgb, alpha) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
  }

  function isDarkTheme() {
    return document.body.classList.contains('theme-dark');
  }

  function shouldDrawGalaxy(width, height) {
    return width >= 960 && height >= 640;
  }

  function drawNebulaGlow(ctx, width, height, options) {
    const gradient = ctx.createRadialGradient(
      width * options.x,
      height * options.y,
      0,
      width * options.x,
      height * options.y,
      Math.max(width, height) * options.radius
    );
    gradient.addColorStop(0, options.inner);
    gradient.addColorStop(0.45, options.middle);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawGalaxyBackdrop(ctx, width, height) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    drawNebulaGlow(ctx, width, height, {
      x: 0.18,
      y: 0.18,
      radius: 0.24,
      inner: 'rgba(140, 182, 255, 0.18)',
      middle: 'rgba(88, 132, 255, 0.08)'
    });

    drawNebulaGlow(ctx, width, height, {
      x: 0.78,
      y: 0.16,
      radius: 0.2,
      inner: 'rgba(196, 132, 255, 0.14)',
      middle: 'rgba(119, 76, 255, 0.08)'
    });

    drawNebulaGlow(ctx, width, height, {
      x: 0.54,
      y: 0.66,
      radius: 0.28,
      inner: 'rgba(104, 182, 255, 0.12)',
      middle: 'rgba(55, 118, 216, 0.06)'
    });

    ctx.translate(width * 0.54, height * 0.48);
    ctx.rotate(-0.42);
    ctx.scale(1.34, 0.34);
    ctx.filter = 'blur(22px)';

    const band = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.34);
    band.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
    band.addColorStop(0.18, 'rgba(194, 220, 255, 0.2)');
    band.addColorStop(0.42, 'rgba(126, 142, 255, 0.12)');
    band.addColorStop(0.68, 'rgba(172, 110, 255, 0.08)');
    band.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, width * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.filter = 'none';
    ctx.restore();
  }

  function drawStars(canvas, config, width, height, random) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (config.drawGalaxy && shouldDrawGalaxy(width, height)) {
      drawGalaxyBackdrop(ctx, width, height);
    }

    const area = width * height;
    const count = Math.max(56, Math.round(area * config.density));
    for (let i = 0; i < count; i += 1) {
      const x = randomBetween(random, 0, width);
      const y = randomBetween(random, 0, height);
      const r = randomBetween(random, config.size[0], config.size[1]);
      const alpha = randomBetween(random, config.alpha[0], config.alpha[1]);
      const color = config.colors[Math.floor(random() * config.colors.length)];
      const isGlowing = random() < config.glowChance;
      const isSparkling = r > 1.3 && random() < config.sparkleChance;

      if (isGlowing) {
        ctx.beginPath();
        ctx.fillStyle = colorWithAlpha(color, alpha * 0.16);
        ctx.arc(x, y, r * 3.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.fillStyle = colorWithAlpha(color, alpha);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      if (isSparkling) {
        ctx.strokeStyle = colorWithAlpha(color, alpha * 0.5);
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(x - r * 2.4, y);
        ctx.lineTo(x + r * 2.4, y);
        ctx.moveTo(x, y - r * 2.4);
        ctx.lineTo(x, y + r * 2.4);
        ctx.stroke();
      }
    }
  }

  function debounce(fn, ms) {
    let id;
    return function (...args) {
      clearTimeout(id);
      id = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  let skyEl = null;
  let layerEls = [];

  function getCanvasSize() {
    var width = window.innerWidth || document.documentElement.clientWidth || 1;
    var height = window.innerHeight || document.documentElement.clientHeight || 1;
    return { width: width, height: height };
  }

  function resizeCanvases(forceDraw) {
    if (!skyEl || !layerEls.length) return;

    var shouldDraw = Boolean(forceDraw) || isDarkTheme();
    var ratio = 1;
    var { width, height } = getCanvasSize();
    layerEls.forEach(function (canvas, index) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      var ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (shouldDraw) {
        drawStars(canvas, layers[index], width, height, Math.random);
      }
    });
  }

  function applySkyVisibility() {
    if (!skyEl) return;

    const darkThemeActive = isDarkTheme();
    skyEl.style.opacity = darkThemeActive ? '1' : '0';
    if (!darkThemeActive) {
      layerEls.forEach((canvas) => {
        canvas.style.transform = 'translate3d(0, 0, 0)';
      });
      return;
    }

    resizeCanvases(true);
  }

  const handleResize = debounce(function () {
    resizeCanvases(false);
  }, 200);

  function initSky() {
    if (skyEl || !isDarkTheme()) return;

    skyEl = document.createElement('div');
    skyEl.className = 'night-sky';
    skyEl.setAttribute('aria-hidden', 'true');

    layerEls = layers.map((layer) => {
      const canvas = document.createElement('canvas');
      canvas.className = layer.className;
      canvas.dataset.depth = String(layer.depth);
      skyEl.appendChild(canvas);
      return canvas;
    });

    document.body.prepend(skyEl);
    resizeCanvases(true);
    applySkyVisibility();
    window.addEventListener('resize', handleResize);
  }

  function syncSkyWithTheme() {
    if (isDarkTheme()) {
      initSky();
    }
    applySkyVisibility();
  }

  if (window.MutationObserver) {
    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        if (entry.attributeName === 'class') {
          syncSkyWithTheme();
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  syncSkyWithTheme();
})();
