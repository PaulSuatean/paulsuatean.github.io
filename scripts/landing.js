(function () {
  window.AncestrioTheme?.initThemeToggle({ persistInitialTheme: true });

  const carousel = document.querySelector('[data-carousel]');
  if (carousel) {
    const track = carousel.querySelector('[data-carousel-track]');
    const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
    const dots = Array.from(carousel.querySelectorAll('[data-carousel-dot]'));
    const prevBtn = carousel.querySelector('[data-carousel-prev]');
    const nextBtn = carousel.querySelector('[data-carousel-next]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const autoDelay = 6000;
    let activeIndex = 0;
    let autoTimer = null;

    function clampIndex(index) {
      if (!slides.length) return 0;
      return (index + slides.length) % slides.length;
    }

    function setActiveSlide(index, options = {}) {
      if (!track || !slides.length) return;
      const nextIndex = clampIndex(index);
      const shouldAnimate = options.animate !== false && !prefersReducedMotion.matches;
      track.style.transition = shouldAnimate ? '' : 'none';
      track.style.transform = `translateX(-${nextIndex * 100}%)`;

      slides.forEach((slide, idx) => {
        const isActive = idx === nextIndex;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });

      dots.forEach((dot, idx) => {
        const isActive = idx === nextIndex;
        dot.classList.toggle('is-active', isActive);
        if (isActive) {
          dot.setAttribute('aria-current', 'true');
        } else {
          dot.removeAttribute('aria-current');
        }
      });

      activeIndex = nextIndex;
    }

    function stopAuto() {
      if (autoTimer) {
        window.clearInterval(autoTimer);
        autoTimer = null;
      }
    }

    function startAuto() {
      if (prefersReducedMotion.matches || slides.length < 2) return;
      stopAuto();
      autoTimer = window.setInterval(() => {
        setActiveSlide(activeIndex + 1);
      }, autoDelay);
    }

    prevBtn?.addEventListener('click', () => {
      setActiveSlide(activeIndex - 1);
      startAuto();
    });

    nextBtn?.addEventListener('click', () => {
      setActiveSlide(activeIndex + 1);
      startAuto();
    });

    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const targetIndex = Number(dot.dataset.carouselDot || 0);
        setActiveSlide(targetIndex);
        startAuto();
      });
    });

    carousel.addEventListener('mouseenter', stopAuto);
    carousel.addEventListener('mouseleave', startAuto);
    carousel.addEventListener('focusin', stopAuto);
    carousel.addEventListener('focusout', startAuto);

    prefersReducedMotion.addEventListener('change', () => {
      setActiveSlide(activeIndex, { animate: false });
      startAuto();
    });

    setActiveSlide(0, { animate: false });
    startAuto();
  }

  const faqItems = Array.from(document.querySelectorAll('.faq-item'));

  function setFaqState(item, isOpen) {
    if (!item) return;
    const toggle = item.querySelector('.faq-toggle');
    const content = item.querySelector('.faq-content');
    if (!toggle || !content) return;

    item.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    content.style.maxHeight = isOpen ? `${content.scrollHeight}px` : '0px';
  }

  faqItems.forEach((item) => {
    const toggle = item.querySelector('.faq-toggle');
    if (!toggle) return;

    setFaqState(item, false);
    toggle.addEventListener('click', () => {
      const shouldOpen = !item.classList.contains('is-open');
      faqItems.forEach((entry) => setFaqState(entry, false));
      setFaqState(item, shouldOpen);
    });
  });

  window.addEventListener('resize', () => {
    faqItems.forEach((item) => {
      if (item.classList.contains('is-open')) {
        setFaqState(item, true);
      }
    });
  });
})();
