(function () {
  if (!document.body) return;
  if (!document.body.hasAttribute('data-ambient-enabled')) return;
  if (!document.body.classList.contains('landing-page')) return;

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const cloudSVG = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="40px" height="24px" viewBox="0 0 40 24" style="enable-background:new 0 0 40 24;" xml:space="preserve">
    <path d="M33.85,14.388c-0.176,0-0.343,0.034-0.513,0.054c0.184-0.587,0.279-1.208,0.279-1.853c0-3.463-2.809-6.271-6.272-6.271 c-0.38,0-0.752,0.039-1.113,0.104C24.874,2.677,21.293,0,17.083,0c-5.379,0-9.739,4.361-9.739,9.738 c0,0.418,0.035,0.826,0.084,1.229c-0.375-0.069-0.761-0.11-1.155-0.11C2.811,10.856,0,13.665,0,17.126 c0,3.467,2.811,6.275,6.272,6.275c0.214,0,27.156,0.109,27.577,0.109c2.519,0,4.56-2.043,4.56-4.562 C38.409,16.43,36.368,14.388,33.85,14.388z"/>
  </svg>`;

  const cloudConfig = {
    count: 10,
    duration: 120,
    verticalRange: [2, 96],
    layers: [
      { className: 'cloud-foreground', multiplier: 1, sizeRange: [42, 68], opacityRange: [0.25, 0.4] },
      { className: 'cloud-background', multiplier: 1.75, sizeRange: [28, 50], opacityRange: [0.15, 0.3] }
    ]
  };

  function initClouds() {
    if (document.body.querySelector('.day-clouds')) return;
    const random = Math.random;

    const cloudsEl = document.createElement('div');
    cloudsEl.className = 'day-clouds';
    cloudsEl.setAttribute('aria-hidden', 'true');

    // Create cloud elements
    for (let i = 0; i < cloudConfig.count; i++) {
      const isBackground = i % 2 === 1;
      const layer = isBackground ? cloudConfig.layers[1] : cloudConfig.layers[0];
      
      const cloudDiv = document.createElement('div');
      cloudDiv.className = `day-cloud ${layer.className}`;
      cloudDiv.innerHTML = cloudSVG;
      
      // Set random size within range
      const size = layer.sizeRange[0] + random() * (layer.sizeRange[1] - layer.sizeRange[0]);
      cloudDiv.style.width = `${size}px`;
      
      // Set random opacity within range (stored for animation)
      const opacity = layer.opacityRange[0] + random() * (layer.opacityRange[1] - layer.opacityRange[0]);
      cloudDiv.style.setProperty('--cloud-base-opacity', opacity);
      
      // Set random vertical position
      const [minTop, maxTop] = cloudConfig.verticalRange;
      const topPosition = minTop + random() * (maxTop - minTop);
      cloudDiv.style.top = `${topPosition}%`;
      
      // Set animation delay and duration
      const delay = -(random() * cloudConfig.duration * layer.multiplier);
      const duration = cloudConfig.duration * layer.multiplier - (i * 4);
      cloudDiv.style.animationDelay = `${delay}s`;
      cloudDiv.style.animationDuration = `${duration}s`;
      
      cloudsEl.appendChild(cloudDiv);
    }

    document.body.prepend(cloudsEl);

    function applyCloudsVisibility() {
      const isDark = document.body.classList.contains('theme-dark');
      cloudsEl.style.opacity = isDark ? '0' : '1';
      cloudsEl.style.animationPlayState = isDark ? 'paused' : 'running';
      var clouds = cloudsEl.querySelectorAll('.day-cloud');
      for (var i = 0; i < clouds.length; i++) {
        clouds[i].style.animationPlayState = isDark ? 'paused' : 'running';
      }
    }

    applyCloudsVisibility();

    if (window.MutationObserver) {
      const observer = new MutationObserver((entries) => {
        for (const entry of entries) {
          if (entry.attributeName === 'class') {
            applyCloudsVisibility();
            break;
          }
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  initClouds();
})();
