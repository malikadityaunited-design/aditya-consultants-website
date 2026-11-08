(() => {
  document.documentElement.classList.add('js-ready');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('header');
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.prepend(progress);

  const filmJourney = document.querySelector('[data-film-journey]');
  const filmStage = filmJourney?.querySelector('[data-film-stage]');
  const filmChapters = filmJourney ? Array.from(filmJourney.querySelectorAll('[data-film-chapter]')) : [];
  const globeCanvas = filmJourney?.querySelector('[data-film-globe]');
  const globeContext = globeCanvas?.getContext('webgl', { alpha: true, antialias: true });
  const indiaGate = filmJourney?.querySelector('[data-india-gate]');
  const londonLandmark = filmJourney?.querySelector('[data-london-landmark]');
  const gateCaption = filmJourney?.querySelector('[data-gate-caption]');
  const bridgeCaption = filmJourney?.querySelector('[data-bridge-caption]');
  const delhiLabel = filmJourney?.querySelector('[data-city-delhi]');
  const londonLabel = filmJourney?.querySelector('[data-city-london]');
  const routeCaption = filmJourney?.querySelector('[data-route-caption]');
  let globeProgram, globeTexture, globeUniforms;
  const makeShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const initGlobe = () => {
    if (!globeContext || !globeCanvas) return;
    const gl = globeContext;
    try {
      const vertex = makeShader(gl, gl.VERTEX_SHADER, `attribute vec2 a_position; void main(){ gl_Position=vec4(a_position,0.0,1.0); }`);
      const fragment = makeShader(gl, gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform vec2 u_resolution;
        uniform vec2 u_center;
        uniform float u_radius;
        uniform float u_latitude;
        uniform float u_longitude;
        uniform float u_opacity;
        uniform float u_route;
        uniform float u_bridge;
        uniform sampler2D u_earth;
        vec3 cityPoint(float latDeg,float lonDeg){
          float lat=latDeg*0.01745329252;
          float lon=(lonDeg-u_longitude*57.295779513)*0.01745329252;
          float cp=cos(lat),sp=sin(lat),cp0=cos(u_latitude),sp0=sin(u_latitude);
          return vec3(cp*sin(lon),cp0*sp-sp0*cp*cos(lon),sp0*sp+cp0*cp*cos(lon));
        }
        void main(){
          vec2 p=(gl_FragCoord.xy-u_center)/u_radius;
          float rr=dot(p,p);
          if(rr>1.0) discard;
          float z=sqrt(max(0.0,1.0-rr));
          float lat=asin(clamp(p.y*cos(u_latitude)+z*sin(u_latitude),-1.0,1.0));
          float lon=u_longitude+atan(p.x,z*cos(u_latitude)-p.y*sin(u_latitude));
          vec2 uv=vec2(fract(lon/6.28318530718+0.5),lat/3.14159265359+0.5);
          vec3 earth=texture2D(u_earth,uv).rgb;
          vec3 normal=normalize(vec3(p,z));
          float light=0.68+0.32*max(0.0,dot(normal,normalize(vec3(-0.36,0.4,0.86))));
          float limb=smoothstep(-0.05,0.34,z);
          float rim=pow(max(0.0,1.0-z),2.4);
          vec3 color=earth*vec3(0.83,0.93,1.0)*light+vec3(0.035,0.16,0.24)*rim;
          vec3 delhi=cityPoint(28.6129,77.2295);
          vec3 london=cityPoint(51.4994,-0.1273);
          float visibleCities=step(0.0,delhi.z)*step(0.0,london.z);
          vec2 control=(delhi.xy+london.xy)*0.5+vec2(0.0,0.15);
          float routeDots=0.0;
          for(int i=0;i<=20;i++){
            float t=float(i)/20.0;
            vec2 a=mix(delhi.xy,control,t);
            vec2 b=mix(control,london.xy,t);
            vec2 point=mix(a,b,t);
            float reveal=smoothstep(max(0.0,t-0.11),t+0.01,u_bridge);
            float pop=exp(-pow((u_bridge-t)*17.0,2.0));
            float radius=0.010+0.009*pop;
            float dotInk=(1.0-smoothstep(radius,radius*1.8,length(p-point)))*reveal*(0.64+0.36*pop);
            float dotGlow=(1.0-smoothstep(radius*1.8,radius*2.5,length(p-point)))*reveal*0.2;
            routeDots=max(routeDots,max(dotInk,dotGlow));
          }
          routeDots*=visibleCities;
          float delhiPin=exp(-dot(p-delhi.xy,p-delhi.xy)*3800.0)*step(0.0,delhi.z)*u_route;
          float londonPin=exp(-dot(p-london.xy,p-london.xy)*3800.0)*step(0.0,london.z)*u_route;
          color=mix(color,vec3(1.0,0.78,0.39),clamp(routeDots+delhiPin,0.0,1.0));
          color=mix(color,vec3(0.68,0.86,1.0),clamp(londonPin,0.0,1.0));
          float alpha=u_opacity*limb;
          // The canvas context uses premultiplied alpha for page compositing.
          // Multiply RGB by alpha so a hidden/transitioning globe stays truly
          // transparent instead of bleeding over the landmark photographs.
          gl_FragColor=vec4(color*alpha,alpha);
        }`);
      globeProgram = gl.createProgram();
      gl.attachShader(globeProgram, vertex);
      gl.attachShader(globeProgram, fragment);
      gl.linkProgram(globeProgram);
      if (!gl.getProgramParameter(globeProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(globeProgram));
      gl.useProgram(globeProgram);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(globeProgram, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      globeUniforms = Object.fromEntries(['u_resolution','u_center','u_radius','u_latitude','u_longitude','u_opacity','u_route','u_bridge','u_earth'].map(name => [name, gl.getUniformLocation(globeProgram, name)]));
      globeTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, globeTexture);
      // The NASA equirectangular texture is non-power-of-two sized, so WebGL 1
      // requires clamp wrapping and non-mipmapped filtering for completeness.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(globeUniforms.u_earth, 0);
      const earth = new Image();
      earth.onload = () => {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, globeTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earth);
        updateFilm();
      };
      earth.src = 'assets/film/earth-map.jpg';
    } catch (error) {
      console.warn('Earth scene could not initialize.', error);
      globeProgram = null;
    }
  };
  const drawGlobe = (progressValue) => {
    if (!globeContext || !globeCanvas || !filmStage || !globeProgram) return;
    const gl = globeContext;
    const box = filmStage.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bufferWidth = Math.round(width * dpr), bufferHeight = Math.round(height * dpr);
    if (globeCanvas.width !== bufferWidth || globeCanvas.height !== bufferHeight) {
      globeCanvas.width = bufferWidth;
      globeCanvas.height = bufferHeight;
    }
    gl.viewport(0, 0, bufferWidth, bufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(globeProgram);
    const smooth = (a, b, value) => {
      const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const globePullback = smooth(.50,.68,progressValue);
    const londonTurn = smooth(.50,.60,progressValue);
    const returnToMidpoint = smooth(.60,.72,progressValue);
    const londonLat = 51.4994, londonLon = -0.1273;
    const midpointLat = (28.6129 + londonLat) / 2;
    const midpointLon = (77.2295 + londonLon) / 2;
    const turnedLat = 28.6129 + (londonLat - 28.6129) * londonTurn;
    const turnedLon = 77.2295 + (londonLon - 77.2295) * londonTurn;
    const centerLat = (turnedLat + (midpointLat - turnedLat) * returnToMidpoint) * Math.PI / 180;
    const centerLon = (turnedLon + (midpointLon - turnedLon) * returnToMidpoint) * Math.PI / 180;
    const pullBack = smooth(.76,.94,progressValue);
    const zoom = (1.32 - .42 * globePullback) * (1 - .18 * pullBack);
    const cx = (window.innerWidth <= 640 ? width * .5 : width * .64) * dpr;
    const cy = (height * (window.innerWidth <= 640 ? .36 : .5)) * dpr;
    const radius = Math.min(height * .57, width * (window.innerWidth <= 640 ? .49 : .40)) * zoom * dpr;
    const mobileSequence = window.innerWidth <= 640;
    // On phones, hand off cleanly from India Gate to Tower Bridge, then to the
    // globe. Keeping these visual beats separate avoids muddy image overlaps.
    const opacity = mobileSequence ? smooth(.50,.56,progressValue) : smooth(.50,.58,progressValue);
    gl.uniform2f(globeUniforms.u_resolution, bufferWidth, bufferHeight);
    gl.uniform2f(globeUniforms.u_center, cx, bufferHeight-cy);
    gl.uniform1f(globeUniforms.u_radius, radius);
    gl.uniform1f(globeUniforms.u_latitude, centerLat);
    gl.uniform1f(globeUniforms.u_longitude, centerLon);
    gl.uniform1f(globeUniforms.u_opacity, opacity);
    const routeReveal = smooth(.57,.72,progressValue);
    const bridgeReveal = smooth(.78,.94,progressValue);
    gl.uniform1f(globeUniforms.u_route, routeReveal);
    gl.uniform1f(globeUniforms.u_bridge, bridgeReveal);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const landmarkWipe = smooth(.22,.29,progressValue);
    const londonIn = 1-smooth(.48,.54,progressValue);
    if (indiaGate) {
      indiaGate.style.setProperty('--landmark-opacity', mobileSequence ? String(1-smooth(.20,.24,progressValue)) : '1');
      indiaGate.style.clipPath = mobileSequence ? 'inset(0)' : `inset(0 ${landmarkWipe*100}% 0 0)`;
    }
    if (indiaGate) indiaGate.style.setProperty('--landmark-scale', String(1.1-.06*smooth(.12,.42,progressValue)));
    if (towerBridge) {
      const mobileBridgeOpacity = smooth(.25,.29,progressValue) * (1-smooth(.46,.50,progressValue));
      towerBridge.style.setProperty('--landmark-opacity', String(mobileSequence ? mobileBridgeOpacity : londonIn));
      towerBridge.style.clipPath = mobileSequence ? 'inset(0)' : `inset(0 0 0 ${(1-landmarkWipe)*100}%)`;
      towerBridge.style.setProperty('--landmark-scale', String(1.13-.09*smooth(.43,.62,progressValue)));
    }
    if (gateCaption) gateCaption.style.opacity = String(1-landmarkWipe);
    if (bridgeCaption) bridgeCaption.style.opacity = String(landmarkWipe*londonIn);
    if (delhiLabel) delhiLabel.style.opacity = String(routeReveal);
    if (londonLabel) londonLabel.style.opacity = String(routeReveal);
    if (routeCaption) routeCaption.style.opacity = String(routeReveal);
  };
  initGlobe();
  let activeFilmScene = -1;
  const updateFilm = () => {
    if (!filmJourney || !filmStage || !filmChapters.length) return;
    const pageTop = filmJourney.getBoundingClientRect().top + window.scrollY;
    const stageHeight = filmStage.getBoundingClientRect().height;
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const start = pageTop - headerHeight;
    const end = pageTop + filmJourney.offsetHeight - stageHeight;
    const progress = end > start ? Math.max(0, Math.min(1, (window.scrollY - start) / (end - start))) : 0;
    const scene = Math.min(filmChapters.length - 1, Math.floor(progress * filmChapters.length));
    filmStage.style.setProperty('--film-progress', String(progress));
    filmStage.style.setProperty('--film-scene', String(scene));
    filmStage.style.setProperty('--film-progress', String(progress));
    drawGlobe(progress);
    const sceneName = ['india', 'turn', 'between', 'bridge'][scene] || 'bridge';
    if (filmStage.dataset.scene !== sceneName) filmStage.dataset.scene = sceneName;
    if (scene !== activeFilmScene) {
      activeFilmScene = scene;
      filmChapters.forEach((chapter, index) => {
        const isActive = index === scene;
        chapter.classList.toggle('is-active', isActive);
        chapter.setAttribute('aria-hidden', String(!isActive));
      });
    }
  };

  let ticking = false;
  const updateScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    document.documentElement.style.setProperty('--scroll-progress', max > 0 ? String(window.scrollY / max) : '0');
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
    updateFilm();
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateScroll);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', () => {
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

  const visitorTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const hasLocalWeatherScene = Boolean(document.querySelector('.weather-scene'));
  const setDaylightTheme = (daylight) => {
    document.body.dataset.daylight = daylight;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = daylight === 'day' ? '#e8edf0' : '#10141b';
  };
  const syncLocalDaylight = () => {
    if (hasLocalWeatherScene) return;
    const localHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: visitorTimeZone, hour: '2-digit', hourCycle: 'h23'
    }).format(new Date()));
    setDaylightTheme(localHour >= 6 && localHour < 18 ? 'day' : 'night');
  };
  syncLocalDaylight();
  window.setInterval(syncLocalDaylight, 60_000);
  const localZoneName = new Intl.DateTimeFormat('en', {
    timeZone: visitorTimeZone,
    timeZoneName: 'long'
  }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || visitorTimeZone;
  const localLabel = document.querySelector('[data-local-label]');
  const localZone = document.querySelector('[data-local-zone]');
  const capitalCity = document.querySelector('[data-capital-city]');
  const capitalCountry = document.querySelector('[data-capital-country]');
  const isUkVisitor = visitorTimeZone === 'Europe/London';

  if (localLabel) localLabel.textContent = 'Your local time';
  if (localZone) localZone.textContent = localZoneName;
  if (isUkVisitor) {
    if (capitalCity) capitalCity.textContent = 'New Delhi';
    if (capitalCountry) capitalCountry.textContent = 'India · capital';
  }

  const clocks = document.querySelectorAll('[data-clock]');
  const analogClocks = document.querySelectorAll('[data-analog-clock]');
  const updateClocks = () => {
    const now = new Date();
    clocks.forEach((clock) => {
      const timeZone = clock.dataset.clock === 'local' ? visitorTimeZone : clock.dataset.clock;
      clock.textContent = new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).format(now);
    });
    analogClocks.forEach((dial) => {
      const timeZone = dial.dataset.analogClock === 'local' ? visitorTimeZone : dial.dataset.analogClock;
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(now).reduce((result, part) => {
        if (part.type === 'hour' || part.type === 'minute' || part.type === 'second') result[part.type] = Number(part.value);
        return result;
      }, {});
      const hour = parts.hour % 12;
      dial.style.setProperty('--clock-hour-angle', `${(hour + parts.minute / 60) * 30}deg`);
      dial.style.setProperty('--clock-minute-angle', `${(parts.minute + parts.second / 60) * 6}deg`);
      dial.style.setProperty('--clock-second-angle', `${parts.second * 6}deg`);
    });
    document.querySelectorAll('[data-clock-offset]').forEach((label) => {
      const timeZone = label.dataset.clockOffset === 'local' ? visitorTimeZone : label.dataset.clockOffset;
      const zone = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'short' }).formatToParts(now).find(part => part.type === 'timeZoneName');
      label.textContent = zone?.value || '';
    });
  };
  if (clocks.length) {
    updateClocks();
    window.setInterval(updateClocks, 1_000);
  }

  const landmarkImages = [
    { element: document.querySelector('[data-india-gate]'), timeZone: 'Asia/Kolkata', latitude: 28.6129, longitude: 77.2295 },
    { element: document.querySelector('[data-london-landmark]'), timeZone: 'Europe/London', latitude: 51.4994, longitude: -0.1273 }
  ].filter((landmark) => landmark.element);
  const setLandmarkTime = (landmark, isDay) => {
    const image = landmark.element;
    const mode = isDay ? 'day' : 'night';
    const nextSource = image.dataset[`${mode}Src`];
    image.dataset.localDaylight = mode;
    if (nextSource) {
      const imageToken = image.hasAttribute('data-india-gate') ? 'india-gate' : 'london';
      document.body.style.setProperty(`--${imageToken}-image`, `url("${nextSource}")`);
      if (image.getAttribute('src') !== nextSource) image.setAttribute('src', nextSource);
    }
  };
  const hourAt = (timeZone) => Number(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hourCycle: 'h23'
  }).format(new Date()));
  landmarkImages.forEach((landmark) => {
    [landmark.element.dataset.daySrc, landmark.element.dataset.nightSrc].filter(Boolean).forEach((src) => {
      const preload = new Image();
      preload.src = src;
    });
    setLandmarkTime(landmark, hourAt(landmark.timeZone) >= 6 && hourAt(landmark.timeZone) < 18);
  });
  const updateLandmarkTimes = async () => {
    await Promise.all(landmarkImages.map(async (landmark) => {
      const query = new URLSearchParams({
        latitude: String(landmark.latitude), longitude: String(landmark.longitude),
        current: 'is_day', timezone: landmark.timeZone
      });
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Landmark daylight unavailable');
        const data = await response.json();
        if (data.current && Number.isFinite(Number(data.current.is_day))) {
          setLandmarkTime(landmark, Number(data.current.is_day) === 1);
        }
      } catch {
        const hour = hourAt(landmark.timeZone);
        setLandmarkTime(landmark, hour >= 6 && hour < 18);
      }
    }));
  };
  if (landmarkImages.length) {
    updateLandmarkTimes();
    window.setInterval(updateLandmarkTimes, 15 * 60 * 1000);
  }

  // Open-Meteo provides free current conditions for this non-commercial site.
  // The browser time zone gives a privacy-friendly regional approximation without requesting location access.
  const weatherScene = document.querySelector('.weather-scene');
  if (weatherScene) {
    const weatherPlace = document.querySelector('[data-weather-place]');
    const weatherSummary = document.querySelector('[data-weather-summary]');
    const weatherTemperature = document.querySelector('[data-weather-temperature]');
    const weatherAreas = {
      'Asia/Kolkata': { lat: 28.67, lon: 77.45, label: 'NEAR GHAZIABAD, INDIA' },
      'Asia/Calcutta': { lat: 28.67, lon: 77.45, label: 'NEAR GHAZIABAD, INDIA' },
      'Europe/London': { lat: 51.51, lon: -0.13, label: 'NEAR LONDON, UK' },
      'Europe/Paris': { lat: 48.86, lon: 2.35, label: 'NEAR PARIS, FRANCE' },
      'Europe/Berlin': { lat: 52.52, lon: 13.4, label: 'NEAR BERLIN, GERMANY' },
      'Europe/Rome': { lat: 41.9, lon: 12.5, label: 'NEAR ROME, ITALY' },
      'Europe/Madrid': { lat: 40.42, lon: -3.7, label: 'NEAR MADRID, SPAIN' },
      'Europe/Amsterdam': { lat: 52.37, lon: 4.9, label: 'NEAR AMSTERDAM, NETHERLANDS' },
      'Asia/Dubai': { lat: 25.2, lon: 55.27, label: 'NEAR DUBAI, UAE' },
      'Asia/Singapore': { lat: 1.35, lon: 103.82, label: 'NEAR SINGAPORE' },
      'Asia/Tokyo': { lat: 35.68, lon: 139.69, label: 'NEAR TOKYO, JAPAN' },
      'Australia/Sydney': { lat: -33.87, lon: 151.21, label: 'NEAR SYDNEY, AUSTRALIA' },
      'America/New_York': { lat: 40.71, lon: -74.01, label: 'NEAR NEW YORK, USA' },
      'America/Chicago': { lat: 41.88, lon: -87.63, label: 'NEAR CHICAGO, USA' },
      'America/Denver': { lat: 39.74, lon: -104.99, label: 'NEAR DENVER, USA' },
      'America/Los_Angeles': { lat: 34.05, lon: -118.24, label: 'NEAR LOS ANGELES, USA' },
      'America/Toronto': { lat: 43.65, lon: -79.38, label: 'NEAR TORONTO, CANADA' },
      'America/Vancouver': { lat: 49.28, lon: -123.12, label: 'NEAR VANCOUVER, CANADA' }
    };
    const fallbackArea = visitorTimeZone.startsWith('Europe/')
      ? { lat: 50.11, lon: 8.68, label: 'NEAR CENTRAL EUROPE' }
      : visitorTimeZone.startsWith('America/')
        ? { lat: 39.1, lon: -94.58, label: 'NEAR CENTRAL USA' }
        : visitorTimeZone.startsWith('Asia/')
          ? { lat: 22.57, lon: 88.36, label: 'NEAR SOUTH ASIA' }
          : { lat: 0, lon: 0, label: 'YOUR LOCAL REGION' };
    const area = weatherAreas[visitorTimeZone] || fallbackArea;
    if (weatherPlace) weatherPlace.textContent = area.label;

    const moonReadout = document.querySelector('[data-moon-phase]');
    const moonArtwork = weatherScene.querySelector('.weather-moon');
    const updateMoonPhase = () => {
      const cycleDays = 29.53058867;
      const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
      const phase = ((Date.now() - knownNewMoon) / 86400000 % cycleDays + cycleDays) % cycleDays / cycleDays;
      const illuminated = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      const phaseNames = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
      const phaseName = phaseNames[Math.round(phase * 8) % 8];
      if (moonReadout) moonReadout.textContent = `${phaseName} · ${Math.round(illuminated * 100)}% lit`;
      if (moonArtwork) moonArtwork.style.setProperty('--moon-shadow-offset', `${(phase < .5 ? -1 : 1) * illuminated * 100}%`);
    };
    updateMoonPhase();
    window.setInterval(updateMoonPhase, 60 * 60 * 1000);

    const conditionFor = (code) => {
      if (code === 0) return ['clear', 'Clear sky'];
      if (code === 1) return ['clear', 'Mostly clear'];
      if (code === 2) return ['cloudy', 'Partly cloudy'];
      if (code === 3) return ['cloudy', 'Overcast'];
      if (code === 45 || code === 48) return ['fog', 'Foggy'];
      if (code >= 51 && code <= 67) return ['rain', 'Rain nearby'];
      if (code >= 71 && code <= 77) return ['snow', 'Snow nearby'];
      if (code >= 80 && code <= 82) return ['rain', 'Showers nearby'];
      if (code === 85 || code === 86) return ['snow', 'Snow showers'];
      if (code >= 95) return ['storm', 'Thunderstorms nearby'];
      return ['cloudy', 'Changing skies'];
    };
    const particleContainer = (kind, count) => {
      const container = weatherScene.querySelector(`[data-weather-particles="${kind}"]`);
      if (!container || container.childElementCount) return;
      for (let i = 0; i < count; i += 1) {
        const particle = document.createElement('i');
        particle.style.setProperty('--particle-x', `${Math.random() * 100}%`);
        particle.style.setProperty('--particle-delay', `${-Math.random() * 6}s`);
        particle.style.setProperty('--particle-duration', `${kind === 'rain' ? 0.55 + Math.random() * 0.6 : 5 + Math.random() * 8}s`);
        particle.style.setProperty('--particle-size', `${1 + Math.random() * 3}px`);
        container.append(particle);
      }
    };
    particleContainer('rain', 46);
    particleContainer('snow', 30);

    const applyWeather = (current) => {
      const [weather, summary] = conditionFor(Number(current.weather_code));
      const daylight = Number(current.is_day) === 1 ? 'day' : 'night';
      document.body.dataset.weather = weather;
      setDaylightTheme(daylight);
      document.body.dataset.clouds = Number(current.cloud_cover) > 62 ? 'many' : 'few';
      if (weatherSummary) weatherSummary.textContent = summary;
      if (weatherTemperature && Number.isFinite(Number(current.temperature_2m))) {
        weatherTemperature.textContent = `${Math.round(Number(current.temperature_2m))}°C`;
      }
    };
    const weatherCacheKey = `ac-weather-v1-${visitorTimeZone}`;
    const cachedWeather = (() => {
      try { return JSON.parse(sessionStorage.getItem(weatherCacheKey) || 'null'); } catch { return null; }
    })();
    if (cachedWeather?.savedAt && Date.now() - cachedWeather.savedAt < 15 * 60 * 1000 && cachedWeather.current) {
      applyWeather(cachedWeather.current);
    }
    const loadWeather = async (coords = area, exactLocation = false) => {
      const query = new URLSearchParams({
        latitude: String(coords.latitude ?? coords.lat), longitude: String(coords.longitude ?? coords.lon),
        current: 'temperature_2m,weather_code,is_day,cloud_cover', timezone: 'auto'
      });
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
        const data = await response.json();
        if (!data.current) throw new Error('Current weather was not included in the response');
        applyWeather(data.current);
        if (weatherPlace) weatherPlace.textContent = exactLocation ? 'YOUR CURRENT LOCATION' : (area.label || 'YOUR LOCAL REGION');
        if (data.timezone === 'Asia/Kolkata' || data.timezone === 'Europe/London') {
          const market = data.timezone === 'Asia/Kolkata' ? 'India' : 'United Kingdom';
          try { sessionStorage.setItem('ac-location-market', market); } catch { /* storage may be unavailable */ }
        } else {
          try { sessionStorage.removeItem('ac-location-market'); } catch { /* storage may be unavailable */ }
        }
        try { sessionStorage.setItem(weatherCacheKey, JSON.stringify({ savedAt: Date.now(), current: data.current })); } catch { /* storage may be unavailable */ }
      } catch {
        if (!cachedWeather?.current) {
          document.body.dataset.weather = 'unknown';
          const localHour = hourAt(visitorTimeZone);
          setDaylightTheme(localHour >= 6 && localHour < 18 ? 'day' : 'night');
          if (weatherSummary) weatherSummary.textContent = 'Local conditions unavailable';
          if (weatherTemperature) weatherTemperature.textContent = '';
        }
      }
    };
    loadWeather();
    window.setInterval(loadWeather, 15 * 60 * 1000);
    const locationButton = document.querySelector('[data-weather-location]');
    const requestExactLocation = () => {
      if (!navigator.geolocation) {
        if (weatherSummary) weatherSummary.textContent = 'Location services are unavailable';
        return;
      }
      if (locationButton) {
        locationButton.disabled = true;
        locationButton.textContent = 'Requesting location…';
      }
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (weatherPlace) weatherPlace.textContent = 'YOUR CURRENT LOCATION';
        if (weatherSummary) weatherSummary.textContent = 'Updating the local sky…';
        if (locationButton) {
          locationButton.textContent = 'Using exact location';
          locationButton.disabled = false;
        }
        loadWeather(coords, true);
      }, () => {
        if (weatherSummary) weatherSummary.textContent = 'Location not shared · showing nearby weather';
        if (locationButton) {
          locationButton.textContent = 'Try location again';
          locationButton.disabled = false;
        }
      }, { enableHighAccuracy: true, maximumAge: 15 * 60 * 1000, timeout: 12_000 });
    };
    if (locationButton) locationButton.addEventListener('click', requestExactLocation);

    // Ask for permission once on page load; if the visitor previously blocked it,
    // leave the manual button available instead of repeatedly prompting.
    const requestLocationOnLoad = async () => {
      if (!navigator.geolocation) return;
      try {
        const permission = await navigator.permissions?.query({ name: 'geolocation' });
        if (permission?.state === 'denied') return;
      } catch { /* Some browsers do not expose the Permissions API. */ }
      requestExactLocation();
    };
    requestLocationOnLoad();
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
