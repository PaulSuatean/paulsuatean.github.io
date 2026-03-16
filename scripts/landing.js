(function () {
  window.AncestrioTheme?.initThemeToggle({ persistInitialTheme: true });

  function debounce(fn, ms) {
    let id;
    return function (...args) {
      clearTimeout(id);
      id = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  const faqItems = Array.from(document.querySelectorAll('.faq-item'));

  function setFaqState(item, isOpen) {
    if (!item) return;
    const toggle = item.querySelector('.faq-toggle');
    const content = item.querySelector('.faq-content');
    if (!toggle || !content) return;

    item.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    content.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    content.style.maxHeight = isOpen ? `${content.scrollHeight}px` : '0px';
  }

  faqItems.forEach((item, index) => {
    const toggle = item.querySelector('.faq-toggle');
    const content = item.querySelector('.faq-content');
    if (!toggle || !content) return;

    const toggleId = `landing-faq-toggle-${index + 1}`;
    const contentId = `landing-faq-content-${index + 1}`;
    toggle.id = toggleId;
    toggle.setAttribute('aria-controls', contentId);
    content.id = contentId;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-labelledby', toggleId);

    setFaqState(item, false);
    toggle.addEventListener('click', () => {
      const shouldOpen = !item.classList.contains('is-open');
      faqItems.forEach((entry) => setFaqState(entry, false));
      setFaqState(item, shouldOpen);
    });
  });

  window.addEventListener('resize', debounce(() => {
    faqItems.forEach((item) => {
      if (item.classList.contains('is-open')) {
        setFaqState(item, true);
      }
    });
  }, 150));
})();
