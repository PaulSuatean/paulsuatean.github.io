/*
  Globe view controller for tree viewer pages.
  Keeps D3/topojson globe rendering and interactions out of main.js.
*/

(function () {
  function createGlobeController(options) {
    const opts = options || {};
    const globeSvgEl = opts.globeSvgEl || null;
    const globeLegendEl = opts.globeLegendEl || null;
    const globeTooltip = opts.globeTooltip || null;
    const normalizeCountryName =
      typeof opts.normalizeCountryName === 'function'
        ? opts.normalizeCountryName
        : function normalizeCountryNameFallback(name) {
          return String(name || '').trim();
        };
    const isActiveView =
      typeof opts.isActiveView === 'function'
        ? opts.isActiveView
        : function isActiveViewFallback() { return true; };
    const onUnavailable =
      typeof opts.onUnavailable === 'function'
        ? opts.onUnavailable
        : function onUnavailableFallback() {};
    const dataUrl = opts.dataUrl || 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
    const remoteThreshold = Number.isFinite(opts.remoteThreshold) ? opts.remoteThreshold : 0.6;
    const verticalOffset = Number.isFinite(opts.verticalOffset) ? opts.verticalOffset : 34;
    const rotationDefault = Number.isFinite(opts.rotationDefault) ? opts.rotationDefault : -15;
    const tiltDefault = Number.isFinite(opts.tiltDefault) ? opts.tiltDefault : -18;
    const tiltMin = Number.isFinite(opts.tiltMin) ? opts.tiltMin : -60;
    const tiltMax = Number.isFinite(opts.tiltMax) ? opts.tiltMax : 60;
    const tiltSpeed = Number.isFinite(opts.tiltSpeed) ? opts.tiltSpeed : 0.22;
    const rotateSpeed = Number.isFinite(opts.rotateSpeed) ? opts.rotateSpeed : 0.3;
    const zoomMin = Number.isFinite(opts.zoomMin) ? opts.zoomMin : 0.9;
    const zoomMax = Number.isFinite(opts.zoomMax) ? opts.zoomMax : 2.56;
    const zoomStep = Number.isFinite(opts.zoomStep) ? opts.zoomStep : 0.12;
    const zoomDefault = Number.isFinite(opts.zoomDefault) ? opts.zoomDefault : 0.92;

    let globeInitialized = false;
    let globeProjection = null;
    let globePath = null;
    let globeSvg = null;
    let globeSpherePath = null;
    let globeBasePaths = null;
    let globeHighlightPaths = null;
    let globeMovedStrokeBluePaths = null;
    let globeMovedStrokeGoldPaths = null;
    let globeCountries = [];
    let globeHighlightFeatures = [];
    let globeRotation = rotationDefault;
    let globeTilt = tiltDefault;
    let globeZoom = zoomDefault;
    let globePinchStartDistance = null;
    let globePinchStartZoom = null;
    let globeDragActive = false;
    let globeVelocityX = 0;
    let globeVelocityY = 0;
    let globeLastDragTime = 0;
    let globeInertiaId = null;
    let globeCenterX = 0;
    let globeCenterY = 0;
    let globeBaseScale = 0;
    let globeBaseSize = 0;
    let globeRenderQueued = false;
    let globeResizeObserver = null;
    let globeResetPending = false;
    let globeHighlightGroup = null;
    let globeVisits = {};

    function normalizeVisitsMap(rawVisits) {
      const normalized = {};
      if (!rawVisits || typeof rawVisits !== 'object') return normalized;

      Object.entries(rawVisits).forEach(([country, info]) => {
        const countryName = normalizeCountryName(country);
        if (!countryName || !info || typeof info !== 'object') return;
        const people = Array.isArray(info.people)
          ? info.people.map((person) => String(person || '').trim()).filter(Boolean)
          : [];
        if (!people.length) return;
        const toneRaw = String(info.tone || '').trim().toLowerCase();
        const tone = toneRaw === 'home' || toneRaw === 'moved' ? toneRaw : 'visited';
        normalized[countryName] = {
          people: Array.from(new Set(people)),
          tone
        };
      });

      return normalized;
    }

    globeVisits = normalizeVisitsMap(opts.globeVisits);

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function isCoarsePointer() {
      return window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
    }

    function pruneRemotePolygons(feature, maxDistance = remoteThreshold) {
      if (!feature || !feature.geometry) return feature;
      if (feature.geometry.type !== 'MultiPolygon') return feature;
      const polygons = feature.geometry.coordinates || [];
      if (polygons.length <= 1) return feature;
      const polyFeatures = polygons.map((coords) => ({
        type: 'Feature',
        properties: feature.properties,
        geometry: { type: 'Polygon', coordinates: coords }
      }));
      let maxIndex = 0;
      let maxArea = -1;
      polyFeatures.forEach((poly, idx) => {
        const area = d3.geoArea(poly);
        if (area > maxArea) {
          maxArea = area;
          maxIndex = idx;
        }
      });
      const main = polyFeatures[maxIndex];
      const mainCentroid = d3.geoCentroid(main);
      const kept = polyFeatures.filter((poly, idx) => {
        if (idx === maxIndex) return true;
        const distance = d3.geoDistance(mainCentroid, d3.geoCentroid(poly));
        return distance <= maxDistance;
      });
      if (kept.length === 1) {
        return { ...feature, geometry: kept[0].geometry };
      }
      return {
        ...feature,
        geometry: {
          type: 'MultiPolygon',
          coordinates: kept.map((poly) => poly.geometry.coordinates)
        }
      };
    }

    function getCountryInfo(name) {
      if (!name) return null;
      const key = normalizeCountryName(name);
      return globeVisits[key] || null;
    }

    function refreshHighlightLayers() {
      if (!globeHighlightGroup || !globeCountries.length) return;

      const byName = new Map(globeCountries.map((country) => [country.properties.name, country]));
      const globeVisitedFeatures = Object.keys(globeVisits)
        .map((name) => byName.get(normalizeCountryName(name)))
        .filter(Boolean);
      globeHighlightFeatures = globeVisitedFeatures.map((feature) => pruneRemotePolygons(feature));
      const movedFeatures = globeHighlightFeatures.filter((feature) => {
        const info = getCountryInfo(feature.properties.name);
        return info && info.tone === 'moved';
      });

      globeHighlightPaths = globeHighlightGroup.selectAll('path.globe-country')
        .data(globeHighlightFeatures)
        .join('path')
        .attr('class', (d) => {
          const info = getCountryInfo(d.properties.name);
          if (!info) return 'globe-country';
          if (info.tone === 'home') return 'globe-country home';
          if (info.tone === 'moved') return 'globe-country moved';
          return 'globe-country visited';
        })
        .attr('data-name', (d) => d.properties.name)
        .on('mouseenter', (event, d) => {
          if (isCoarsePointer()) return;
          const info = getCountryInfo(d.properties.name);
          if (!info) return;
          const pointer = d3.pointer(event, globeSvgEl);
          showGlobeTooltip(d.properties.name, info.people, pointer[0], pointer[1], false, false);
        })
        .on('mousemove', (event, d) => {
          if (isCoarsePointer()) return;
          const info = getCountryInfo(d.properties.name);
          if (!info) return;
          const pointer = d3.pointer(event, globeSvgEl);
          showGlobeTooltip(d.properties.name, info.people, pointer[0], pointer[1], false, false);
        })
        .on('mouseleave', () => {
          if (isCoarsePointer()) return;
          hideGlobeTooltip();
        })
        .on('click', (event, d) => {
          const info = getCountryInfo(d.properties.name);
          if (!info) {
            hideGlobeTooltip(true);
            return;
          }
          event.stopPropagation();
          const rect = globeSvgEl.getBoundingClientRect();
          const lock = isCoarsePointer();
          showGlobeTooltip(d.properties.name, info.people, rect.width / 2, 16, lock, lock);
        });

      globeMovedStrokeBluePaths = globeHighlightGroup.selectAll('path.globe-moved-stroke-blue')
        .data(movedFeatures)
        .join('path')
        .attr('class', 'globe-moved-stroke globe-moved-stroke-blue')
        .attr('data-name', (d) => d.properties.name);

      globeMovedStrokeGoldPaths = globeHighlightGroup.selectAll('path.globe-moved-stroke-gold')
        .data(movedFeatures)
        .join('path')
        .attr('class', 'globe-moved-stroke globe-moved-stroke-gold')
        .attr('data-name', (d) => d.properties.name);

      renderGlobe();
    }

    function setVisits(nextVisits) {
      globeVisits = normalizeVisitsMap(nextVisits);
      refreshHighlightLayers();
    }

    function showGlobeTooltip(name, people, x, y, centered = false, lock = false) {
      if (!globeTooltip) return;
      const listItems = (people && people.length)
        ? people.map((person) => `<li class="tooltip-pill">${escapeHtml(person)}</li>`).join('')
        : '<li class="tooltip-pill">Fara date</li>';
      globeTooltip.innerHTML = `
      <div class="tooltip-title">${escapeHtml(name)}</div>
      <ul class="tooltip-list">${listItems}</ul>
    `;
      globeTooltip.hidden = false;
      globeTooltip.classList.toggle('centered', centered);
      globeTooltip.classList.add('show');
      if (centered) {
        globeTooltip.style.left = '50%';
        globeTooltip.style.top = '14px';
      } else {
        globeTooltip.style.left = `${Math.round(x)}px`;
        globeTooltip.style.top = `${Math.round(y)}px`;
      }
      globeTooltip.dataset.locked = lock ? 'true' : 'false';
    }

    function hideGlobeTooltip(force = false) {
      if (!globeTooltip) return;
      if (!force && globeTooltip.dataset.locked === 'true') return;
      globeTooltip.classList.remove('show', 'centered');
      globeTooltip.hidden = true;
      globeTooltip.dataset.locked = 'false';
    }

    function normalizeRotation(angle) {
      return ((angle + 180) % 360 + 360) % 360 - 180;
    }

    function clampTilt(value) {
      return Math.max(tiltMin, Math.min(tiltMax, value));
    }

    function stopGlobeInertia() {
      if (!globeInertiaId) return;
      cancelAnimationFrame(globeInertiaId);
      globeInertiaId = null;
    }

    function renderGlobe() {
      if (!globePath || !globeSpherePath) return;
      globeSpherePath.attr('d', globePath({ type: 'Sphere' }));
      if (globeBasePaths) globeBasePaths.attr('d', globePath);
      if (globeHighlightPaths) globeHighlightPaths.attr('d', globePath);
      if (globeMovedStrokeBluePaths) globeMovedStrokeBluePaths.attr('d', globePath);
      if (globeMovedStrokeGoldPaths) globeMovedStrokeGoldPaths.attr('d', globePath);
    }

    function applyGlobeProjection() {
      if (!globeProjection || !globeBaseScale || !globeBaseSize) return;
      const radius = globeBaseScale * globeZoom;
      if (globeLegendEl) {
        const overflow = Math.max(0, radius - globeBaseSize / 2);
        const offset = overflow > 0 ? overflow + 12 : 0;
        globeLegendEl.style.marginTop = '';
        globeLegendEl.style.transform = offset ? `translateY(${Math.round(offset)}px)` : '';
      }
      globeProjection
        .translate([globeCenterX, globeCenterY])
        .scale(radius)
        .rotate([globeRotation, globeTilt]);
      renderGlobe();
    }

    function setZoom(nextZoom) {
      const clamped = Math.min(zoomMax, Math.max(zoomMin, nextZoom));
      if (Math.abs(clamped - globeZoom) < 0.001) return;
      globeZoom = clamped;
      applyGlobeProjection();
    }

    function adjustZoom(delta) {
      setZoom(globeZoom + delta);
    }

    function handleGlobeWheel(event) {
      if (!isActiveView()) return;
      event.preventDefault();
      stopGlobeInertia();
      const direction = event.deltaY < 0 ? 1 : -1;
      adjustZoom(direction * zoomStep);
    }

    function handleGlobeTouchStart(event) {
      if (!isActiveView()) return;
      if (event.touches && event.touches.length === 2) {
        stopGlobeInertia();
        const first = event.touches[0];
        const second = event.touches[1];
        globePinchStartDistance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        globePinchStartZoom = globeZoom;
      }
    }

    function handleGlobeTouchMove(event) {
      if (!isActiveView()) return;
      if (!event.touches || event.touches.length !== 2) return;
      if (!globePinchStartDistance || globePinchStartZoom == null) return;
      event.preventDefault();
      const first = event.touches[0];
      const second = event.touches[1];
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      if (!distance) return;
      const factor = distance / globePinchStartDistance;
      setZoom(globePinchStartZoom * factor);
    }

    function handleGlobeTouchEnd(event) {
      if (event.touches && event.touches.length >= 2) return;
      globePinchStartDistance = null;
      globePinchStartZoom = null;
    }

    function scheduleGlobeRender() {
      if (globeRenderQueued) return;
      globeRenderQueued = true;
      requestAnimationFrame(() => {
        globeRenderQueued = false;
        if (!globeProjection) return;
        globeProjection.rotate([globeRotation, globeTilt]);
        renderGlobe();
      });
    }

    function resize() {
      if (!globeSvgEl || !globeProjection || !globePath) return;
      const rect = globeSvgEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const size = Math.min(rect.width, rect.height);
      globeCenterX = rect.width / 2;
      globeCenterY = (rect.height / 2) + verticalOffset;
      globeBaseScale = (size / 2) - 12;
      globeBaseSize = size;
      if (globeResetPending) {
        globeRotation = rotationDefault;
        globeTilt = tiltDefault;
        globeZoom = zoomDefault;
        globeResetPending = false;
      }
      applyGlobeProjection();
    }

    function ensureVisible(tries = 60) {
      if (!globeSvgEl) return;
      if (!globeProjection) {
        if (tries <= 0) return;
        requestAnimationFrame(() => ensureVisible(tries - 1));
        return;
      }
      const rect = globeSvgEl.getBoundingClientRect();
      if (rect.width && rect.height) {
        resize();
        return;
      }
      if (tries <= 0) return;
      requestAnimationFrame(() => ensureVisible(tries - 1));
    }

    function resetView() {
      stopGlobeInertia();
      globeResetPending = true;
      globeRotation = rotationDefault;
      globeTilt = tiltDefault;
      globeZoom = zoomDefault;
      globePinchStartDistance = null;
      globePinchStartZoom = null;
      globeDragActive = false;
      globeVelocityX = 0;
      globeVelocityY = 0;
      globeLastDragTime = 0;
      hideGlobeTooltip(true);
      if (globeProjection) {
        globeProjection.rotate([globeRotation, globeTilt]);
        applyGlobeProjection();
      }
    }

    function init() {
      if (!globeSvgEl) return false;
      if (globeInitialized) return true;
      if (typeof topojson === 'undefined') {
        console.warn('TopoJSON client missing, globe view disabled.');
        return false;
      }

      globeInitialized = true;
      globeSvg = d3.select(globeSvgEl);

      if (!globeResizeObserver && typeof ResizeObserver !== 'undefined') {
        globeResizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.contentRect.width && entry.contentRect.height) {
              resize();
              break;
            }
          }
        });
        globeResizeObserver.observe(globeSvgEl);
      }

      globeProjection = d3.geoOrthographic()
        .clipAngle(90)
        .precision(1.1)
        .rotate([globeRotation, globeTilt]);
      globePath = d3.geoPath().projection(globeProjection);
      globeSpherePath = globeSvg.append('path').attr('class', 'globe-sphere');
      const countriesGroup = globeSvg.append('g').attr('class', 'globe-countries');
      globeHighlightGroup = globeSvg.append('g').attr('class', 'globe-highlights');

      globeSvg.style('cursor', 'grab');
      if (globeSvgEl.setPointerCapture) {
        globeSvgEl.addEventListener('pointerdown', (event) => {
          globeSvgEl.setPointerCapture(event.pointerId);
        });
        const releasePointer = (event) => {
          if (globeSvgEl.hasPointerCapture && globeSvgEl.hasPointerCapture(event.pointerId)) {
            globeSvgEl.releasePointerCapture(event.pointerId);
          }
        };
        globeSvgEl.addEventListener('pointerup', releasePointer);
        globeSvgEl.addEventListener('pointercancel', releasePointer);
      }
      globeSvgEl.addEventListener('wheel', handleGlobeWheel, { passive: false });
      globeSvgEl.addEventListener('touchstart', handleGlobeTouchStart, { passive: false });
      globeSvgEl.addEventListener('touchmove', handleGlobeTouchMove, { passive: false });
      globeSvgEl.addEventListener('touchend', handleGlobeTouchEnd);
      globeSvgEl.addEventListener('touchcancel', handleGlobeTouchEnd);

      d3.json(dataUrl).then((world) => {
        if (!world || !world.objects || !world.objects.countries) {
          console.warn('Globe data is missing required countries data.');
          if (isActiveView()) onUnavailable();
          return;
        }

        globeCountries = topojson.feature(world, world.objects.countries).features || [];

        globeBasePaths = countriesGroup.selectAll('path.globe-country-base')
          .data(globeCountries)
          .join('path')
          .attr('class', 'globe-country globe-country-base')
          .attr('data-name', (d) => d.properties.name);

        refreshHighlightLayers();

        globeSvg.on('click', (event) => {
          const target = event.target;
          if (!target || !target.classList) {
            hideGlobeTooltip(true);
            return;
          }
          if (!target.classList.contains('globe-country')) {
            hideGlobeTooltip(true);
            return;
          }
          const name = target.getAttribute('data-name');
          if (!getCountryInfo(name)) hideGlobeTooltip(true);
        });

        function dragStarted() {
          globeSvg.style('cursor', 'grabbing');
          hideGlobeTooltip(true);
          globeDragActive = true;
          globeVelocityX = 0;
          globeVelocityY = 0;
          globeLastDragTime = performance.now();
          stopGlobeInertia();
        }

        function dragged(event) {
          if (!globeDragActive) return;
          const now = performance.now();
          const dt = Math.max(12, now - globeLastDragTime);
          globeLastDragTime = now;
          const dx = event.dx || 0;
          const dy = event.dy || 0;
          globeRotation = normalizeRotation(globeRotation + dx * rotateSpeed);
          globeTilt = clampTilt(globeTilt - dy * tiltSpeed);
          globeVelocityX = (dx * rotateSpeed) / dt;
          globeVelocityY = (-dy * tiltSpeed) / dt;
          scheduleGlobeRender();
        }

        function dragEnded() {
          globeSvg.style('cursor', 'grab');
          globeDragActive = false;
          startGlobeInertia();
        }

        function startGlobeInertia() {
          const minVelocity = 0.0008;
          if (Math.abs(globeVelocityX) < minVelocity && Math.abs(globeVelocityY) < minVelocity) return;
          let lastTime = performance.now();
          const step = () => {
            const now = performance.now();
            const dt = Math.max(12, now - lastTime);
            lastTime = now;
            const decay = Math.pow(0.92, dt / 16);
            globeVelocityX *= decay;
            globeVelocityY *= decay;
            if (Math.abs(globeVelocityX) < minVelocity && Math.abs(globeVelocityY) < minVelocity) {
              globeInertiaId = null;
              return;
            }
            globeRotation = normalizeRotation(globeRotation + globeVelocityX * dt);
            globeTilt = clampTilt(globeTilt + globeVelocityY * dt);
            scheduleGlobeRender();
            globeInertiaId = requestAnimationFrame(step);
          };
          globeInertiaId = requestAnimationFrame(step);
        }

        globeSvg.call(
          d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded)
        );

        resize();
        ensureVisible();
      }).catch((err) => {
        console.warn('Failed to load globe data:', err);
        if (isActiveView()) onUnavailable();
      });

      return true;
    }

    return {
      init,
      ensureVisible,
      resize,
      resetView,
      setZoom,
      adjustZoom,
      setVisits
    };
  }

  window.AncestrioGlobeUI = window.AncestrioGlobeUI || {};
  window.AncestrioGlobeUI.createGlobeController = createGlobeController;
})();
