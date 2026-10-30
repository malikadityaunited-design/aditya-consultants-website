(() => {
  document.documentElement.classList.add('js-ready');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('header');
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.prepend(progress);

  let ticking = false;
  const updateScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    document.documentElement.style.setProperty('--scroll-progress', max > 0 ? String(window.scrollY / max) : '0');
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateScroll);
      ticking = true;
    }
  }, { passive: true });
  updateScroll();

  const revealItems = document.querySelectorAll('[data-reveal]');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const clocks = document.querySelectorAll('[data-clock]');
  const updateClocks = () => clocks.forEach((clock) => {
    clock.textContent = new Intl.DateTimeFormat('en-GB', {
      timeZone: clock.dataset.clock,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date());
  });
  if (clocks.length) {
    updateClocks();
    window.setInterval(updateClocks, 60_000);
  }

  const hero = document.querySelector('.home-hero');
  const heroAside = document.querySelector('.hero-aside');
  if (hero && heroAside && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (event) => {
      const bounds = hero.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      heroAside.style.setProperty('--pointer-x', `${x * 12}px`);
      heroAside.style.setProperty('--pointer-y', `${y * 12}px`);
    });
    hero.addEventListener('pointerleave', () => {
      heroAside.style.setProperty('--pointer-x', '0px');
      heroAside.style.setProperty('--pointer-y', '0px');
    });
  }
})();
