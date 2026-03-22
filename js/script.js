/**
 * Códigos Postales del Mundo – Main JavaScript
 * Version: 1.0.0
 * Features: Global search, Leaflet maps, SPA routing, FAQ accordion, lazy loading
 * Dependencies: Leaflet.js (loaded via CDN)
 */

(function () {
  'use strict';

  /* ================================================================
     1. GLOBALS & STATE
     ================================================================ */
  let DATA = null;
  const CACHE = {};
  const BASE_PATH = location.pathname.replace(/\/[^/]*$/, '');

  /* Barrios system – lazy loaded per department */
  let BARRIOS_INDEX = null;
  const BARRIOS_CACHE = {};
  let barriosSearchIndex = [];

  /* Colonias system for Mexico – same architecture */
  let COLONIAS_INDEX = null;
  const COLONIAS_CACHE = {};

  /* Neighborhoods system for USA – same architecture */
  let NEIGHBORHOODS_INDEX = null;
  const NEIGHBORHOODS_CACHE = {};

  /* ================================================================
     2. DATA LOADING
     ================================================================ */
  const DATA_VERSION = '20'; // v19: Barrios system added with lazy loading

  async function loadData() {
    if (DATA) return DATA;
    try {
      const res = await fetch(resolvePath('data/codigos.json') + '?v=' + DATA_VERSION);
      DATA = await res.json();
      buildSearchIndex();
      return DATA;
    } catch (e) {
      console.error('Error cargando datos:', e);
      return null;
    }
  }

  function resolvePath(path) {
    // Works with any hosting root
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return '/' + path;
    }
    return BASE_PATH + '/' + path;
  }

  /* ================================================================
     2b. BARRIOS LAZY LOADING SYSTEM
     Loads barrio data on-demand per department to keep main JSON light.
     Each department file is ~1-10KB, loaded only when user visits a city.
     ================================================================ */
  async function loadBarriosIndex() {
    if (BARRIOS_INDEX) return BARRIOS_INDEX;
    try {
      const res = await fetch(resolvePath('data/barrios/index.json') + '?v=' + DATA_VERSION);
      BARRIOS_INDEX = await res.json();
      return BARRIOS_INDEX;
    } catch (e) {
      console.warn('Barrios index not available:', e);
      return null;
    }
  }

  /**
   * Load barrios for a specific city.
   * Finds the department file from the index, loads it, then returns barrios for cityId.
   * @param {string} cityId - e.g. "bogota", "medellin"
   * @param {string} state - e.g. "Cundinamarca", "Antioquia"
   * @returns {Object|null} - { cityId, cityName, state, totalBarrios, zones: [...] }
   */
  async function loadBarriosForCity(cityId, state) {
    const index = await loadBarriosIndex();
    if (!index) return null;

    // Find which department file contains this city
    let deptKey = null;
    for (const [key, val] of Object.entries(index)) {
      if (val.cities && val.cities.includes(cityId)) {
        deptKey = key;
        break;
      }
    }
    if (!deptKey) return null;

    // Load department file if not cached
    if (!BARRIOS_CACHE[deptKey]) {
      try {
        const res = await fetch(resolvePath(index[deptKey].file) + '?v=' + DATA_VERSION);
        BARRIOS_CACHE[deptKey] = await res.json();
      } catch (e) {
        console.warn('Error loading barrios for', deptKey, e);
        return null;
      }
    }

    // Find city data within the department
    const deptData = BARRIOS_CACHE[deptKey];
    if (!deptData || !deptData.cities) return null;
    const cityBarrios = deptData.cities.find(c => c.cityId === cityId);
    return cityBarrios || null;
  }

  /**
   * Add barrios to the global search index for a loaded department
   * Called after barrio data is loaded so users can search "Alquería", "El Poblado", etc.
   */
  function addBarriosToSearchIndex(deptData, countryId) {
    if (!deptData || !deptData.cities) return;
    const country = DATA?.countries?.find(c => c.id === countryId);
    if (!country) return;

    deptData.cities.forEach(cityData => {
      const parentCity = country.cities.find(c => c.id === cityData.cityId);
      if (!parentCity) return;

      cityData.zones.forEach(zone => {
        // Avoid duplicates
        const uid = `barrio-${cityData.cityId}-${zone.postalCode}-${zone.name}`;
        if (searchIndex.find(s => s.uid === uid)) return;

        searchIndex.push({
          uid: uid,
          type: 'barrio',
          id: cityData.cityId,
          countryId: countryId,
          name: zone.name,
          flag: country.flag,
          country: country.name,
          postalCode: zone.postalCode,
          state: parentCity.state,
          parentCity: parentCity.name,
          localidad: zone.localidad,
          keywords: [zone.name, zone.postalCode, zone.localidad, parentCity.name, parentCity.state, country.name].join(' ').toLowerCase(),
          url: `city.html?country=${countryId}&city=${cityData.cityId}&barrio=${encodeURIComponent(zone.name)}`
        });
      });
    });
  }

  /* ================================================================
     2c. MEXICO COLONIAS LOADING SYSTEM
     Same lazy-loading architecture as Colombia barrios
     ================================================================ */
  async function loadColoniasIndex() {
    if (COLONIAS_INDEX) return COLONIAS_INDEX;
    try {
      const res = await fetch(resolvePath('data/colonias/index.json') + '?v=' + DATA_VERSION);
      COLONIAS_INDEX = await res.json();
      return COLONIAS_INDEX;
    } catch (e) {
      console.warn('Colonias index not available:', e);
      return null;
    }
  }

  async function loadColoniasForCity(cityId) {
    const index = await loadColoniasIndex();
    if (!index) return null;

    let stateKey = null;
    for (const [key, val] of Object.entries(index)) {
      if (val.cities && val.cities.includes(cityId)) {
        stateKey = key;
        break;
      }
    }
    if (!stateKey) return null;

    if (!COLONIAS_CACHE[stateKey]) {
      try {
        const res = await fetch(resolvePath(index[stateKey].file) + '?v=' + DATA_VERSION);
        COLONIAS_CACHE[stateKey] = await res.json();
      } catch (e) {
        console.warn('Error loading colonias for', stateKey, e);
        return null;
      }
    }

    const stateData = COLONIAS_CACHE[stateKey];
    if (!stateData || !stateData.cities) return null;
    return stateData.cities.find(c => c.cityId === cityId) || null;
  }

  function addColoniasToSearchIndex(stateData, countryId) {
    if (!stateData || !stateData.cities) return;
    const country = DATA?.countries?.find(c => c.id === countryId);
    if (!country) return;

    stateData.cities.forEach(cityData => {
      const parentCity = country.cities.find(c => c.id === cityData.cityId);
      if (!parentCity) return;

      cityData.zones.forEach(zone => {
        const uid = `colonia-${cityData.cityId}-${zone.postalCode}-${zone.name}`;
        if (searchIndex.find(s => s.uid === uid)) return;

        searchIndex.push({
          uid: uid,
          type: 'barrio',
          id: cityData.cityId,
          countryId: countryId,
          name: zone.name,
          flag: country.flag,
          country: country.name,
          postalCode: zone.postalCode,
          state: parentCity.state,
          parentCity: parentCity.name,
          localidad: zone.localidad,
          keywords: [zone.name, zone.postalCode, zone.localidad, parentCity.name, parentCity.state, country.name, 'colonia'].join(' ').toLowerCase(),
          url: `city.html?country=${countryId}&city=${cityData.cityId}&barrio=${encodeURIComponent(zone.name)}`
        });
      });
    });
  }

  /* ================================================================
     2d. USA NEIGHBORHOODS LOADING SYSTEM
     ================================================================ */
  async function loadNeighborhoodsIndex() {
    if (NEIGHBORHOODS_INDEX) return NEIGHBORHOODS_INDEX;
    try {
      const res = await fetch(resolvePath('data/neighborhoods/index.json') + '?v=' + DATA_VERSION);
      NEIGHBORHOODS_INDEX = await res.json();
      return NEIGHBORHOODS_INDEX;
    } catch (e) {
      return null;
    }
  }

  async function loadNeighborhoodsForCity(cityId) {
    const index = await loadNeighborhoodsIndex();
    if (!index) return null;
    let stateKey = null;
    for (const [key, val] of Object.entries(index)) {
      if (val.cities && val.cities.includes(cityId)) { stateKey = key; break; }
    }
    if (!stateKey) return null;
    if (!NEIGHBORHOODS_CACHE[stateKey]) {
      try {
        const res = await fetch(resolvePath(index[stateKey].file) + '?v=' + DATA_VERSION);
        NEIGHBORHOODS_CACHE[stateKey] = await res.json();
      } catch (e) { return null; }
    }
    const stateData = NEIGHBORHOODS_CACHE[stateKey];
    if (!stateData || !stateData.cities) return null;
    return stateData.cities.find(c => c.cityId === cityId) || null;
  }

  function addNeighborhoodsToSearchIndex(stateData, countryId) {
    if (!stateData || !stateData.cities) return;
    const country = DATA?.countries?.find(c => c.id === countryId);
    if (!country) return;
    stateData.cities.forEach(cityData => {
      const parentCity = country.cities.find(c => c.id === cityData.cityId);
      if (!parentCity) return;
      cityData.zones.forEach(zone => {
        const uid = `nb-${cityData.cityId}-${zone.postalCode}-${zone.name}`;
        if (searchIndex.find(s => s.uid === uid)) return;
        searchIndex.push({
          uid, type: 'barrio', id: cityData.cityId, countryId,
          name: zone.name, flag: country.flag, country: country.name,
          postalCode: zone.postalCode, state: parentCity.state,
          parentCity: parentCity.name, localidad: zone.localidad,
          keywords: [zone.name, zone.postalCode, zone.localidad, parentCity.name, parentCity.state, country.name, 'neighborhood', 'zip code'].join(' ').toLowerCase(),
          url: `city.html?country=${countryId}&city=${cityData.cityId}&barrio=${encodeURIComponent(zone.name)}`
        });
      });
    });
  }

  /* ================================================================
     3. SEARCH INDEX & FUNCTIONALITY
     ================================================================ */
  let searchIndex = [];

  function buildSearchIndex() {
    if (!DATA) return;
    searchIndex = [];
    DATA.countries.forEach(country => {
      // Add country itself
      searchIndex.push({
        type: 'country',
        id: country.id,
        name: country.name,
        flag: country.flag,
        keywords: [country.name, country.nameEn, country.iso, country.flag].join(' ').toLowerCase(),
        url: `country.html?id=${country.id}`
      });
      // Add each city
      country.cities.forEach(city => {
        searchIndex.push({
          type: 'city',
          id: city.id,
          countryId: country.id,
          name: city.name,
          flag: country.flag,
          country: country.name,
          postalCode: city.postalCode,
          state: city.state,
          keywords: [city.name, city.postalCode, city.postalRange, city.state, country.name, country.nameEn].join(' ').toLowerCase(),
          url: `city.html?country=${country.id}&city=${city.id}`
        });
      });
    });
  }

  function searchData(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase().trim();
    const results = searchIndex.filter(item => item.keywords.includes(q));
    // Sort: exact name match first, then barrios > cities > countries
    const typePriority = { barrio: 0, city: 1, country: 2 };
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bExact = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aPri = typePriority[a.type] ?? 3;
      const bPri = typePriority[b.type] ?? 3;
      return aPri - bPri;
    });
    return results.slice(0, 10);
  }

  /* ================================================================
     4. SEARCH UI
     ================================================================ */
  function initSearch() {
    const input = document.getElementById('global-search');
    const resultsContainer = document.getElementById('search-results');
    if (!input || !resultsContainer) return;

    let debounceTimer;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = input.value;
        const results = searchData(query);
        renderSearchResults(results, resultsContainer, query);
      }, 200);
    });

    input.addEventListener('focus', () => {
      if (input.value.length >= 2) {
        resultsContainer.classList.add('active');
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        resultsContainer.classList.remove('active');
      }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const items = resultsContainer.querySelectorAll('.search-result-item');
      const active = resultsContainer.querySelector('.search-result-item:focus');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!active) items[0]?.focus();
        else active.nextElementSibling?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) active.previousElementSibling?.focus() || input.focus();
      } else if (e.key === 'Escape') {
        resultsContainer.classList.remove('active');
        input.blur();
      }
    });
  }

  function renderSearchResults(results, container, query) {
    // If query is too short, hide results
    if (!query || query.length < 2) {
      container.classList.remove('active');
      return;
    }

    // No results found — show friendly message
    if (results.length === 0) {
      container.innerHTML = `
        <div style="padding:1.5rem;text-align:center">
          <div style="font-size:2rem;margin-bottom:.5rem">🔍</div>
          <p style="font-weight:600;font-size:.95rem;color:var(--color-text);margin-bottom:.35rem">
            "${query}" aún no está disponible
          </p>
          <p style="font-size:.85rem;color:var(--color-text-muted);line-height:1.6;margin-bottom:.75rem">
            Estamos expandiendo nuestra base de datos constantemente. Pronto agregaremos más ciudades y municipios.
          </p>
          <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
            <a href="contacto.html" style="font-size:.82rem;padding:.4rem .8rem;background:var(--color-primary);color:#fff;border-radius:var(--radius-full);font-weight:600;transition:opacity .2s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
              📩 Solicitar esta ciudad
            </a>
            <a href="guias.html" style="font-size:.82rem;padding:.4rem .8rem;background:rgba(30,64,175,.06);color:var(--color-primary);border-radius:var(--radius-full);font-weight:600;transition:background .2s" onmouseover="this.style.background='rgba(30,64,175,.12)'" onmouseout="this.style.background='rgba(30,64,175,.06)'">
              📖 Ver guías de envíos
            </a>
          </div>
        </div>
      `;
      container.classList.add('active');
      return;
    }

    // Show results
    container.innerHTML = results.map(r => {
      if (r.type === 'barrio') {
        return `<a href="${r.url}" class="search-result-item" role="option" tabindex="0">
          <span class="flag">🏘️</span>
          <span class="info">
            <span class="city-name">${r.name}</span>
            <span style="font-size:.8rem;color:var(--color-text-muted)">${r.localidad} · ${r.parentCity}, ${r.state}</span>
          </span>
          <span class="code">${r.postalCode}</span>
        </a>`;
      }
      if (r.type === 'city') {
        return `<a href="${r.url}" class="search-result-item" role="option" tabindex="0">
          <span class="flag">${r.flag}</span>
          <span class="info">
            <span class="city-name">${r.name}</span>
            <span style="font-size:.8rem;color:var(--color-text-muted)">${r.state}, ${r.country}</span>
          </span>
          <span class="code">${r.postalCode}</span>
        </a>`;
      }
      return `<a href="${r.url}" class="search-result-item" role="option" tabindex="0">
        <span class="flag">${r.flag}</span>
        <span class="info">
          <span class="city-name">${r.name}</span>
          <span style="font-size:.8rem;color:var(--color-text-muted)">Ver todos los códigos</span>
        </span>
        <span style="font-size:1.1rem">→</span>
      </a>`;
    }).join('');
    container.classList.add('active');
  }

  /* ================================================================
     5. MAP INITIALIZATION (Leaflet) – ENHANCED
     Features: Fly animation, click-to-find nearest postal code, improved popups
     ================================================================ */
  function initMap(containerId, lat, lng, zoom, markers = [], options = {}) {
    const el = document.getElementById(containerId);
    if (!el || typeof L === 'undefined') return null;

    // Destroy existing map
    if (el._leaflet_id) {
      el._leafletMap?.remove();
    }

    // Start zoomed out (globe view) if fly animation requested
    const startZoom = options.flyAnimation ? 3 : zoom;
    const map = L.map(containerId, {
      scrollWheelZoom: false,
      attributionControl: true,
      zoomAnimation: true,
      markerZoomAnimation: true
    }).setView([lat, lng], startZoom);

    el._leafletMap = map;

    // OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18
    }).addTo(map);

    // Fly animation: zoom from globe to location (like Google Earth)
    if (options.flyAnimation) {
      setTimeout(() => {
        map.flyTo([lat, lng], zoom, {
          duration: 2.5,
          easeLinearity: 0.2
        });
      }, 400);
    }

    // Custom marker icon
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        width:28px;height:28px;
        background:var(--color-primary);
        border:3px solid #fff;
        border-radius:50%;
        box-shadow:0 2px 8px rgba(0,0,0,.3);
        transition: transform .2s;
      "></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -16]
    });

    // Add markers
    markers.forEach(m => {
      const marker = L.marker([m.lat, m.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:var(--font-body);min-width:200px">
            <strong style="font-size:1.05rem">${m.flag || ''} ${m.name}</strong><br>
            <span style="font-family:var(--font-mono);color:var(--color-primary);font-weight:700;font-size:1.1rem">${m.postalCode}</span><br>
            ${m.state ? `<span style="font-size:.85rem;color:#666">${m.state}</span><br>` : ''}
            ${m.url ? `<a href="${m.url}" style="display:inline-block;margin-top:.4rem;font-size:.85rem;color:#fff;background:var(--color-primary);padding:.3rem .7rem;border-radius:6px;font-weight:600;text-decoration:none">Ver detalle →</a>` : ''}
          </div>
        `);
      if (m.openPopup) {
        // Delay popup open until fly animation completes
        setTimeout(() => marker.openPopup(), options.flyAnimation ? 2800 : 200);
      }
    });

    // CLICK-TO-FIND: When user clicks anywhere on map, find nearest city
    if (options.clickToFind && searchIndex.length > 0) {
      let clickMarker = null;

      map.on('click', (e) => {
        const clickLat = e.latlng.lat;
        const clickLng = e.latlng.lng;

        // Find nearest city from our database
        let nearest = null;
        let minDist = Infinity;

        searchIndex.forEach(item => {
          if (item.type !== 'city') return;
          // Find city data to get coordinates
          for (const country of DATA.countries) {
            const city = country.cities.find(c => c.id === item.id);
            if (city) {
              const dist = Math.sqrt(
                Math.pow(clickLat - city.lat, 2) + Math.pow(clickLng - city.lng, 2)
              );
              if (dist < minDist) {
                minDist = dist;
                nearest = { city, country, item };
              }
              break;
            }
          }
        });

        if (nearest && minDist < 5) {
          // Remove previous click marker
          if (clickMarker) map.removeLayer(clickMarker);

          const { city, country, item } = nearest;
          const clickIcon = L.divIcon({
            className: 'click-marker',
            html: `<div style="
              width:22px;height:22px;
              background:var(--color-accent);
              border:3px solid #fff;
              border-radius:50%;
              box-shadow:0 2px 12px rgba(245,158,11,.4);
              animation: pulse-marker 1.5s ease infinite;
            "></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            popupAnchor: [0, -14]
          });

          clickMarker = L.marker([city.lat, city.lng], { icon: clickIcon })
            .addTo(map)
            .bindPopup(`
              <div style="font-family:var(--font-body);min-width:200px">
                <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:.2rem">Ciudad más cercana</div>
                <strong style="font-size:1.05rem">${country.flag} ${city.name}</strong><br>
                <span style="font-family:var(--font-mono);color:var(--color-primary);font-weight:700;font-size:1.1rem">${city.postalCode}</span><br>
                <span style="font-size:.85rem;color:#666">${city.state}, ${country.name}</span><br>
                <span style="font-size:.82rem;color:#999">Rango: ${city.postalRange}</span><br>
                <a href="${item.url}" style="display:inline-block;margin-top:.4rem;font-size:.85rem;color:#fff;background:var(--color-primary);padding:.3rem .7rem;border-radius:6px;font-weight:600;text-decoration:none">Ver detalle →</a>
              </div>
            `)
            .openPopup();

          // Smooth pan to nearest city
          map.panTo([city.lat, city.lng], { animate: true, duration: 0.5 });
        } else if (nearest) {
          // Too far from any known city
          if (clickMarker) map.removeLayer(clickMarker);

          const tempIcon = L.divIcon({
            className: 'temp-marker',
            html: `<div style="
              width:18px;height:18px;
              background:rgba(100,116,139,.5);
              border:2px solid #fff;
              border-radius:50%;
              box-shadow:0 1px 6px rgba(0,0,0,.2);
            "></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            popupAnchor: [0, -12]
          });

          clickMarker = L.marker([clickLat, clickLng], { icon: tempIcon })
            .addTo(map)
            .bindPopup(`
              <div style="font-family:var(--font-body);min-width:160px;text-align:center">
                <div style="font-size:1.3rem;margin-bottom:.3rem">🔍</div>
                <p style="font-size:.88rem;color:#555;margin:0">Esta zona aún no está en nuestra base de datos</p>
                <p style="font-size:.78rem;color:#999;margin:.3rem 0">La ciudad más cercana es <strong>${nearest.city.name}</strong></p>
                <a href="${nearest.item.url}" style="font-size:.82rem;color:var(--color-primary);font-weight:600">Ver ${nearest.city.name} →</a>
              </div>
            `)
            .openPopup();
        }
      });
    }

    // Enable scroll zoom after first interaction
    map.once('click', () => map.scrollWheelZoom.enable());

    // Refresh tiles
    setTimeout(() => map.invalidateSize(), 200);

    return map;
  }

  /* ================================================================
     6. PAGE RENDERERS
     ================================================================ */

  // 6a. HOME PAGE
  async function renderHome() {
    const data = await loadData();
    if (!data) return;

    const grid = document.getElementById('countries-grid');
    if (!grid) return;

    grid.innerHTML = data.countries.map(c => `
      <a href="country.html?id=${c.id}" class="country-card" aria-label="Ver códigos postales de ${c.name}">
        <span class="flag-big">${c.flag}</span>
        <h3>${c.name}</h3>
        <p style="font-size:.9rem;color:var(--color-text-muted);margin:0">${c.cities.length} ciudades principales</p>
        <div class="meta">
          <span>📮 ${c.format}</span>
          <span>🏙️ ${c.totalCodes}</span>
        </div>
        <span class="format-badge">${c.format}</span>
      </a>
    `).join('');

    // Init search
    initSearch();

    // Preload barrios index for global search (non-blocking)
    loadBarriosIndex().then(idx => {
      if (!idx) return;
      const priorityDepts = ['cundinamarca', 'antioquia', 'valle-del-cauca', 'atlantico', 'bolivar'];
      priorityDepts.forEach(deptKey => {
        if (idx[deptKey] && idx[deptKey].file) {
          fetch(resolvePath(idx[deptKey].file) + '?v=' + DATA_VERSION)
            .then(r => r.json())
            .then(deptData => {
              BARRIOS_CACHE[deptKey] = deptData;
              addBarriosToSearchIndex(deptData, 'colombia');
            })
            .catch(() => {});
        }
      });
    });

    // Preload Mexico colonias for global search (non-blocking)
    loadColoniasIndex().then(idx => {
      if (!idx) return;
      const priorityStates = ['ciudad-de-mexico', 'jalisco', 'nuevo-leon'];
      priorityStates.forEach(stKey => {
        if (idx[stKey] && idx[stKey].file) {
          fetch(resolvePath(idx[stKey].file) + '?v=' + DATA_VERSION)
            .then(r => r.json())
            .then(stateData => {
              COLONIAS_CACHE[stKey] = stateData;
              addColoniasToSearchIndex(stateData, 'mexico');
            })
            .catch(() => {});
        }
      });
    });

    // Update structured data count
    const countEl = document.getElementById('total-countries');
    if (countEl) countEl.textContent = data.countries.length;
    const cityCountEl = document.getElementById('total-cities');
    if (cityCountEl) {
      const baseCities = data.countries.reduce((sum, c) => sum + c.cities.length, 0);
      cityCountEl.textContent = baseCities.toLocaleString('es');
    }

    // Update barrios count after index loads (non-blocking)
    loadBarriosIndex().then(idx => {
      if (!idx) return;
      let totalBarrios = 0;
      for (const dk in idx) {
        totalBarrios += idx[dk].totalBarrios || 0;
      }
      const barriosCountEl = document.getElementById('total-barrios');
      if (barriosCountEl) barriosCountEl.textContent = totalBarrios.toLocaleString('es');
    });
  }

  // 6b. COUNTRY PAGE
  async function renderCountry() {
    const params = new URLSearchParams(location.search);
    const countryId = params.get('id');
    if (!countryId) return;

    const data = await loadData();
    if (!data) return;

    const country = data.countries.find(c => c.id === countryId);
    if (!country) {
      document.getElementById('country-content').innerHTML = '<p>País no encontrado.</p>';
      return;
    }

    // Page title & meta – optimized for viral keywords
    document.title = `Códigos Postales de ${country.name} ${country.flag} – Lista Completa y Buscador ${new Date().getFullYear()}`;
    setMeta('description', `Todos los códigos postales de ${country.name} ${new Date().getFullYear()}. ${country.totalCodes} con buscador gratis, mapa interactivo, barrios y colonias. ¿Cuál es mi código postal en ${country.name}? Encuéntralo aquí.`);

    // Breadcrumbs
    setBreadcrumbs([
      { label: 'Inicio', url: 'index.html' },
      { label: country.name, url: null }
    ]);

    // Header info
    const header = document.getElementById('country-header');
    if (header) {
      header.innerHTML = `
        <span style="font-size:3.5rem">${country.flag}</span>
        <h1 class="section-title">Códigos Postales de ${country.name}</h1>
        <p class="section-subtitle">${country.description}</p>
        <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem">
          <span class="badge">📮 Formato: ${country.format}</span>
          <span class="badge">🏙️ ${country.totalCodes}</span>
          <span class="badge">🔗 ${country.postalAuthority}</span>
        </div>
      `;
    }

    // Map with all cities
    const markers = country.cities.map(city => ({
      lat: city.lat,
      lng: city.lng,
      name: city.name,
      postalCode: city.postalCode,
      state: city.state,
      flag: country.flag,
      url: `city.html?country=${country.id}&city=${city.id}`
    }));
    initMap('country-map', country.lat, country.lng, country.zoom, markers, { flyAnimation: true, clickToFind: true });

    // City list
    const cityList = document.getElementById('city-list');
    if (cityList) {
      cityList.innerHTML = country.cities.map(city => `
        <a href="city.html?country=${country.id}&city=${city.id}" class="city-item">
          <span class="postal-code">${city.postalCode}</span>
          <div class="city-info">
            <h4>${city.name}</h4>
            <p>${city.state} · Rango: ${city.postalRange}</p>
          </div>
        </a>
      `).join('');
    }

    // Schema.org
    injectSchema({
      "@context": "https://schema.org",
      "@type": "Dataset",
      "name": `Códigos Postales de ${country.name}`,
      "description": country.description,
      "url": location.href,
      "license": "https://creativecommons.org/licenses/by/4.0/",
      "creator": { "@type": "Organization", "name": "Códigos Postales del Mundo" },
      "dateModified": data.meta.lastUpdated
    });
  }

  // 6c. CITY PAGE
  async function renderCity() {
    const params = new URLSearchParams(location.search);
    const countryId = params.get('country');
    const cityId = params.get('city');
    if (!countryId || !cityId) return;

    const data = await loadData();
    if (!data) return;

    const country = data.countries.find(c => c.id === countryId);
    if (!country) return;
    const city = country.cities.find(c => c.id === cityId);
    if (!city) return;

    // Page title & meta – enhanced for barrio deep links
    const urlBarrioName = params.get('barrio') ? decodeURIComponent(params.get('barrio')) : null;
    if (urlBarrioName) {
      document.title = `Código Postal de ${urlBarrioName}, ${city.name} ${country.flag} – CP / ZIP Code ${city.postalCode}`;
      setMeta('description', `Código postal de ${urlBarrioName} en ${city.name}, ${city.state}, ${country.name}. CP ${city.postalCode}. Busca tu barrio o colonia con mapa interactivo. Find your ZIP code / postal code.`);
    } else {
      document.title = `Código Postal de ${city.name} ${country.flag} – CP ${city.postalCode} | ZIP Code ${new Date().getFullYear()}`;
      setMeta('description', `El código postal de ${city.name} es ${city.postalCode}. Rango: ${city.postalRange}. Todos los barrios, colonias y zonas postales con mapa. ¿Cuál es mi código postal en ${city.name}? Encuéntralo aquí gratis.`);
    }

    // Breadcrumbs
    setBreadcrumbs([
      { label: 'Inicio', url: 'index.html' },
      { label: country.name, url: `country.html?id=${country.id}` },
      { label: city.name, url: null }
    ]);

    // City header
    const header = document.getElementById('city-header');
    if (header) {
      header.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <span style="font-size:2.5rem">${country.flag}</span>
          <div>
            <h1 class="section-title" style="margin:0">Código Postal de ${city.name}</h1>
            <p style="color:var(--color-text-muted);margin:0.25rem 0 0">${city.state}, ${country.name} · <span id="reading-time"></span></p>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;margin-top:1rem">
          <div style="background:var(--color-primary);color:#fff;padding:0.75rem 1.5rem;border-radius:var(--radius-lg);font-family:var(--font-mono);font-size:1.5rem;font-weight:700;letter-spacing:0.05em">
            ${city.postalCode}
          </div>
          <button data-copy="${city.postalCode}" style="padding:0.6rem 1rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);cursor:pointer;font-family:var(--font-body);font-size:.88rem;font-weight:600;color:var(--color-primary);display:flex;align-items:center;gap:0.4rem;transition:all 150ms" aria-label="Copiar código postal ${city.postalCode}">
            📋 Copiar código
          </button>
          <button data-share style="padding:0.6rem 1rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);cursor:pointer;font-family:var(--font-body);font-size:.88rem;font-weight:600;color:var(--color-text-muted);display:flex;align-items:center;gap:0.4rem;transition:all 150ms" aria-label="Compartir esta página">
            🔗 Compartir
          </button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-top:1rem">
          <div style="display:flex;flex-direction:column">
            <span style="font-size:.78rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Rango completo</span>
            <span style="font-family:var(--font-mono);font-weight:600;color:var(--color-primary);font-size:1.05rem">${city.postalRange}</span>
          </div>
          <div style="display:flex;flex-direction:column">
            <span style="font-size:.78rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Población</span>
            <span style="font-weight:600;font-size:1.05rem">${city.population}</span>
          </div>
          <div style="display:flex;flex-direction:column">
            <span style="font-size:.78rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Formato</span>
            <span style="font-family:var(--font-mono);font-weight:600;font-size:1.05rem">${country.format}</span>
          </div>
          <div style="display:flex;flex-direction:column">
            <span style="font-size:.78rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Fuente oficial</span>
            <a href="${country.postalAuthorityUrl}" target="_blank" rel="noopener" style="font-weight:600;font-size:.95rem">${country.postalAuthority.split('–')[0].trim()}</a>
          </div>
        </div>
      `;
    }

    // Map – store reference so we can add barrio markers later
    const cityMap = initMap('city-map', city.lat, city.lng, city.zoom, [{
      lat: city.lat,
      lng: city.lng,
      name: city.name,
      postalCode: city.postalCode,
      state: city.state,
      flag: country.flag,
      openPopup: true
    }], { flyAnimation: true, clickToFind: true });

    // Info cards
    const infoGrid = document.getElementById('city-info-grid');
    if (infoGrid) {
      infoGrid.innerHTML = `
        <div class="info-card">
          <div class="card-icon">📜</div>
          <h3>Historia Postal</h3>
          <p>${city.history}</p>
        </div>
        <div class="info-card">
          <div class="card-icon">📦</div>
          <h3>Consejo para Envíos</h3>
          <p>${city.shippingTip}</p>
        </div>
        <div class="info-card">
          <div class="card-icon">💡</div>
          <h3>¿Sabías que...?</h3>
          <p>${city.curiosity}</p>
        </div>
        <div class="info-card">
          <div class="card-icon">📮</div>
          <h3>Autoridad Postal</h3>
          <p>${country.postalAuthority}. Formato oficial: ${country.format}. Consulta tu código exacto en <a href="${country.postalAuthorityUrl}" target="_blank" rel="noopener">${country.postalAuthorityUrl}</a>.</p>
        </div>
      `;
    }

    // Description
    const descEl = document.getElementById('city-description');
    if (descEl) descEl.innerHTML = `<p>${city.description}</p>`;

    /* ============================================================
       BARRIOS/COLONIAS SECTION – Lazy loaded
       Works for Colombia (barrios) and Mexico (colonias)
       ============================================================ */
    const barriosSection = document.getElementById('barrios-section');
    const isColombiaOrMexico = (countryId === 'colombia' || countryId === 'mexico' || countryId === 'usa');
    if (barriosSection && isColombiaOrMexico) {
      // Show loading state
      barriosSection.style.display = 'block';
      const barriosContainer = document.getElementById('barrios-container');
      if (barriosContainer) {
        barriosContainer.innerHTML = `
          <div style="text-align:center;padding:2rem">
            <div class="barrios-loader"></div>
            <p style="color:var(--color-text-muted);margin-top:1rem;font-size:.9rem">Cargando barrios y zonas postales...</p>
          </div>
        `;
      }

      // Load barrios/colonias/neighborhoods data asynchronously
      const loadPromise = countryId === 'mexico'
        ? loadColoniasForCity(cityId)
        : countryId === 'usa'
          ? loadNeighborhoodsForCity(cityId)
          : loadBarriosForCity(cityId, city.state);

      loadPromise.then(barrioData => {
        if (!barrioData || !barrioData.zones || barrioData.zones.length === 0) {
          // No barrios available for this city
          barriosSection.style.display = 'none';
          return;
        }

        // Add barrios/colonias/neighborhoods to global search index
        if (countryId === 'mexico') {
          const stKey = Object.keys(COLONIAS_CACHE).find(k => COLONIAS_CACHE[k]?.cities?.find(c => c.cityId === cityId));
          if (stKey && COLONIAS_CACHE[stKey]) {
            addColoniasToSearchIndex(COLONIAS_CACHE[stKey], countryId);
          }
        } else if (countryId === 'usa') {
          const stKey = Object.keys(NEIGHBORHOODS_CACHE).find(k => NEIGHBORHOODS_CACHE[k]?.cities?.find(c => c.cityId === cityId));
          if (stKey && NEIGHBORHOODS_CACHE[stKey]) {
            addNeighborhoodsToSearchIndex(NEIGHBORHOODS_CACHE[stKey], countryId);
          }
        } else {
          const deptKey = Object.keys(BARRIOS_CACHE).find(k => BARRIOS_CACHE[k]?.cities?.find(c => c.cityId === cityId));
          if (deptKey && BARRIOS_CACHE[deptKey]) {
            addBarriosToSearchIndex(BARRIOS_CACHE[deptKey], countryId);
          }
        }

        const zones = barrioData.zones;

        // Group by localidad for organized display
        const byLocalidad = {};
        zones.forEach(z => {
          const loc = z.localidad || 'Otros';
          if (!byLocalidad[loc]) byLocalidad[loc] = [];
          byLocalidad[loc].push(z);
        });

        // Count unique postal codes
        const uniqueCodes = [...new Set(zones.map(z => z.postalCode))];

        // Build barrios HTML
        if (barriosContainer) {
          barriosContainer.innerHTML = `
            <!-- Barrios stats bar -->
            <div class="barrios-stats">
              <div class="barrios-stat">
                <span class="barrios-stat-num">${zones.length}</span>
                <span class="barrios-stat-label">${countryId === 'mexico' ? 'Colonias' : countryId === 'usa' ? 'Neighborhoods' : 'Barrios'}</span>
              </div>
              <div class="barrios-stat">
                <span class="barrios-stat-num">${uniqueCodes.length}</span>
                <span class="barrios-stat-label">${countryId === 'usa' ? 'ZIP Codes' : 'Códigos Postales'}</span>
              </div>
              <div class="barrios-stat">
                <span class="barrios-stat-num">${Object.keys(byLocalidad).length}</span>
                <span class="barrios-stat-label">${countryId === 'mexico' ? 'Alcaldías/Zonas' : countryId === 'usa' ? 'Boroughs/Areas' : (cityId === 'medellin' ? 'Comunas' : 'Localidades')}</span>
              </div>
            </div>

            <!-- Barrios search -->
            <div class="barrios-search-box">
              <input type="text" id="barrios-search" placeholder="🔍 Buscar barrio, código postal o localidad..." 
                     aria-label="Buscar barrio en ${city.name}"
                     autocomplete="off" spellcheck="false">
              <span id="barrios-search-count" class="barrios-search-count">${zones.length} barrios</span>
            </div>

            <!-- View toggles -->
            <div class="barrios-view-toggles">
              <button class="barrios-view-btn active" data-view="list" aria-label="Vista de lista">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>
                Lista
              </button>
              <button class="barrios-view-btn" data-view="grid" aria-label="Vista de cuadrícula">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                Cuadrícula
              </button>
              <button class="barrios-view-btn" data-view="map" aria-label="Vista de mapa">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 3l4.5-1.5 5 2 4.5-1.5v11l-4.5 1.5-5-2L1 14V3z"/></svg>
                Mapa
              </button>
            </div>

            <!-- List view (default) -->
            <div id="barrios-list-view" class="barrios-list-view">
              ${Object.entries(byLocalidad).map(([loc, barrios]) => `
                <div class="barrios-localidad-group">
                  <h4 class="barrios-localidad-title">
                    <span class="barrios-localidad-icon">📍</span>
                    ${loc}
                    <span class="barrios-localidad-count">${barrios.length}</span>
                  </h4>
                  <div class="barrios-list">
                    ${barrios.map(b => `
                      <div class="barrio-item" data-name="${b.name.toLowerCase()}" data-code="${b.postalCode}" data-localidad="${b.localidad.toLowerCase()}">
                        <div class="barrio-info">
                          <span class="barrio-name">${b.name}</span>
                          <span class="barrio-loc">${b.localidad}</span>
                        </div>
                        <div class="barrio-code-wrap">
                          <span class="barrio-code">${b.postalCode}</span>
                          <button class="barrio-copy-btn" data-copy="${b.postalCode}" aria-label="Copiar ${b.postalCode}" title="Copiar código">
                            📋
                          </button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Grid view (hidden by default) -->
            <div id="barrios-grid-view" class="barrios-grid-view" style="display:none">
              ${zones.map(b => `
                <div class="barrio-card" data-name="${b.name.toLowerCase()}" data-code="${b.postalCode}" data-localidad="${b.localidad.toLowerCase()}">
                  <div class="barrio-card-code">${b.postalCode}</div>
                  <div class="barrio-card-name">${b.name}</div>
                  <div class="barrio-card-loc">${b.localidad}</div>
                  <button class="barrio-copy-btn" data-copy="${b.postalCode}" aria-label="Copiar ${b.postalCode}">📋 Copiar</button>
                </div>
              `).join('')}
            </div>

            <!-- Map view (hidden by default) -->
            <div id="barrios-map-view" style="display:none">
              <div id="barrios-map" style="height:450px;border-radius:var(--radius-lg);overflow:hidden"></div>
            </div>

            <!-- No results message -->
            <div id="barrios-no-results" style="display:none;text-align:center;padding:2rem">
              <div style="font-size:2rem;margin-bottom:.5rem">🔍</div>
              <p style="font-weight:600;color:var(--color-text)">No se encontraron barrios</p>
              <p style="font-size:.85rem;color:var(--color-text-muted)">Intenta con otro nombre o código postal</p>
            </div>
          `;

          // ---- BARRIOS INTERACTIVITY ----
          initBarriosInteractivity(zones, byLocalidad, city, country, cityMap);

          // ---- BARRIOS SCHEMA.ORG (SEO) ----
          // Add PostalAddress schema for each unique postal code in barrios
          const schemaBarrios = zones.slice(0, 50).map(z => ({
            "@type": "PostalAddress",
            "addressLocality": z.name,
            "addressRegion": city.state,
            "addressCountry": "CO",
            "postalCode": z.postalCode
          }));
          injectSchema({
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": `Barrios y Códigos Postales de ${city.name}`,
            "description": `Lista completa de ${zones.length} barrios con códigos postales en ${city.name}, Colombia`,
            "numberOfItems": zones.length,
            "itemListElement": schemaBarrios.map((item, i) => ({
              "@type": "ListItem",
              "position": i + 1,
              "item": item
            }))
          });
        }

        // Highlight barrio from URL param
        const urlBarrio = new URLSearchParams(location.search).get('barrio');
        if (urlBarrio) {
          setTimeout(() => {
            const searchInput = document.getElementById('barrios-search');
            if (searchInput) {
              searchInput.value = decodeURIComponent(urlBarrio);
              searchInput.dispatchEvent(new Event('input'));
              // Scroll to barrios section
              barriosSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 500);
        }
      });
    }

    // FAQs
    const faqList = document.getElementById('faq-list');
    if (faqList && city.faqs?.length) {
      faqList.innerHTML = city.faqs.map((faq, i) => `
        <div class="faq-item" data-faq="${i}">
          <button class="faq-question" aria-expanded="false" aria-controls="faq-answer-${i}">
            <span>${faq.question}</span>
            <svg class="faq-chevron" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="5 8 10 13 15 8"/>
            </svg>
          </button>
          <div class="faq-answer" id="faq-answer-${i}" role="region">
            <p>${faq.answer}</p>
          </div>
        </div>
      `).join('');
      initFAQAccordion();
    }

    // Related cities
    const relatedGrid = document.getElementById('related-cities');
    if (relatedGrid && city.relatedCities?.length) {
      const relatedHtml = city.relatedCities.map(rid => {
        for (const c of data.countries) {
          const found = c.cities.find(ct => ct.id === rid);
          if (found) {
            return `<a href="city.html?country=${c.id}&city=${found.id}" class="related-card">
              <span style="font-size:1.5rem">${c.flag}</span>
              <div>
                <strong style="font-size:.92rem">${found.name}</strong><br>
                <span style="font-family:var(--font-mono);font-size:.85rem;color:var(--color-primary)">${found.postalCode}</span>
              </div>
            </a>`;
          }
        }
        return '';
      }).join('');
      relatedGrid.innerHTML = relatedHtml;
    }

    // Schema: PostalAddress + FAQPage
    const schemas = [
      {
        "@context": "https://schema.org",
        "@type": "PostalAddress",
        "addressLocality": city.name,
        "addressRegion": city.state,
        "addressCountry": country.iso,
        "postalCode": city.postalCode
      }
    ];
    if (city.faqs?.length) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": city.faqs.map(f => ({
          "@type": "Question",
          "name": f.question,
          "acceptedAnswer": { "@type": "Answer", "text": f.answer }
        }))
      });
    }
    schemas.forEach(s => injectSchema(s));
  }

  /* ================================================================
     6d. BARRIOS INTERACTIVITY
     Search filter, view toggles, barrios map, copy buttons
     ================================================================ */
  function initBarriosInteractivity(zones, byLocalidad, city, country, parentMap) {
    // --- Search/filter ---
    const searchInput = document.getElementById('barrios-search');
    const countEl = document.getElementById('barrios-search-count');
    const noResults = document.getElementById('barrios-no-results');
    const listView = document.getElementById('barrios-list-view');
    const gridView = document.getElementById('barrios-grid-view');

    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const q = searchInput.value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          let visible = 0;

          // Filter list view items
          if (listView) {
            listView.querySelectorAll('.barrio-item').forEach(item => {
              const name = (item.dataset.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const code = item.dataset.code || '';
              const loc = (item.dataset.localidad || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const match = !q || name.includes(q) || code.includes(q) || loc.includes(q);
              item.style.display = match ? '' : 'none';
              if (match) visible++;
            });
            // Hide empty localidad groups
            listView.querySelectorAll('.barrios-localidad-group').forEach(group => {
              const hasVisible = group.querySelector('.barrio-item:not([style*="display: none"])');
              group.style.display = hasVisible ? '' : 'none';
            });
          }

          // Filter grid view items
          if (gridView) {
            gridView.querySelectorAll('.barrio-card').forEach(card => {
              const name = (card.dataset.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const code = card.dataset.code || '';
              const loc = (card.dataset.localidad || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const match = !q || name.includes(q) || code.includes(q) || loc.includes(q);
              card.style.display = match ? '' : 'none';
            });
          }

          // Update count
          if (countEl) countEl.textContent = q ? `${visible} resultado${visible !== 1 ? 's' : ''}` : `${zones.length} barrios`;
          if (noResults) noResults.style.display = (q && visible === 0) ? 'block' : 'none';
        }, 150);
      });
    }

    // --- View toggles ---
    const viewBtns = document.querySelectorAll('.barrios-view-btn');
    let barriosMap = null;

    viewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (listView) listView.style.display = view === 'list' ? '' : 'none';
        if (gridView) gridView.style.display = view === 'grid' ? '' : 'none';
        const mapView = document.getElementById('barrios-map-view');
        if (mapView) mapView.style.display = view === 'map' ? '' : 'none';

        // Initialize barrios map on first show
        if (view === 'map' && !barriosMap) {
          setTimeout(() => {
            barriosMap = initBarriosMap(zones, city, country);
          }, 100);
        }
        if (view === 'map' && barriosMap) {
          setTimeout(() => barriosMap.invalidateSize(), 100);
        }
      });
    });
  }

  /**
   * Initialize a dedicated map for barrios with colored markers by localidad
   */
  function initBarriosMap(zones, city, country) {
    const el = document.getElementById('barrios-map');
    if (!el || typeof L === 'undefined') return null;

    const map = L.map('barrios-map', {
      scrollWheelZoom: true,
      attributionControl: true
    }).setView([city.lat, city.lng], city.zoom + 1);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18
    }).addTo(map);

    // Color palette for localidades
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
                    '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#d946ef', '#22c55e', '#eab308', '#f43f5e', '#2563eb', '#7c3aed'];
    const localidades = [...new Set(zones.map(z => z.localidad))];

    zones.forEach(zone => {
      if (!zone.lat || !zone.lng) return;
      const colorIdx = localidades.indexOf(zone.localidad) % colors.length;
      const color = colors[colorIdx];

      const icon = L.divIcon({
        className: 'barrio-marker',
        html: `<div style="
          width:14px;height:14px;
          background:${color};
          border:2px solid #fff;
          border-radius:50%;
          box-shadow:0 1px 4px rgba(0,0,0,.3);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10]
      });

      L.marker([zone.lat, zone.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:var(--font-body);min-width:180px">
            <strong style="font-size:.95rem">${zone.name}</strong><br>
            <span style="font-family:var(--font-mono);color:${color};font-weight:700;font-size:1rem">${zone.postalCode}</span><br>
            <span style="font-size:.82rem;color:#666">${zone.localidad}</span><br>
            <button onclick="navigator.clipboard.writeText('${zone.postalCode}');this.textContent='✅ Copiado'" 
                    style="margin-top:.3rem;padding:.2rem .6rem;border:1px solid ${color};border-radius:4px;background:transparent;color:${color};cursor:pointer;font-size:.78rem;font-weight:600">
              📋 Copiar código
            </button>
          </div>
        `);
    });

    // Add legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'barrios-legend');
      div.style.cssText = 'background:rgba(255,255,255,.95);padding:.6rem .8rem;border-radius:8px;font-size:.75rem;max-height:200px;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,.15)';
      div.innerHTML = '<strong style="display:block;margin-bottom:.3rem;font-size:.8rem">Localidades</strong>' +
        localidades.slice(0, 12).map((loc, i) =>
          `<div style="display:flex;align-items:center;gap:.3rem;margin:.15rem 0"><span style="width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};flex-shrink:0"></span><span>${loc}</span></div>`
        ).join('');
      return div;
    };
    legend.addTo(map);

    // Fit bounds to all markers
    const bounds = zones.filter(z => z.lat && z.lng).map(z => [z.lat, z.lng]);
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    setTimeout(() => map.invalidateSize(), 200);
    return map;
  }

  /* ================================================================
     7. FAQ ACCORDION
     ================================================================ */
  function initFAQAccordion() {
    document.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('open');
        // Close all
        document.querySelectorAll('.faq-item.open').forEach(el => {
          el.classList.remove('open');
          el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        });
        // Open clicked (if was closed)
        if (!isOpen) {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  /* ================================================================
     8. UTILITY FUNCTIONS
     ================================================================ */
  function setMeta(name, content) {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute('content', content);
    else {
      el = document.createElement('meta');
      el.name = name;
      el.content = content;
      document.head.appendChild(el);
    }
  }

  function setBreadcrumbs(items) {
    const el = document.getElementById('breadcrumbs');
    if (!el) return;
    const html = items.map((item, i) => {
      if (item.url) {
        return `<a href="${item.url}">${item.label}</a>`;
      }
      return `<span aria-current="page">${item.label}</span>`;
    }).join('<span class="sep">›</span>');
    el.innerHTML = html;

    // BreadcrumbList schema
    injectSchema({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": items.map((item, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "name": item.label,
        "item": item.url ? location.origin + '/' + item.url : undefined
      }))
    });
  }

  function injectSchema(schema) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  /* ================================================================
     9. HEADER SCROLL EFFECT
     ================================================================ */
  function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          header.classList.toggle('scrolled', window.scrollY > 10);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ================================================================
     10. MOBILE MENU
     ================================================================ */
  function initMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav = document.getElementById('nav-links');
    const overlay = document.getElementById('nav-overlay');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
      overlay?.classList.toggle('active', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    overlay?.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  /* ================================================================
     11. LAST UPDATED DATE
     ================================================================ */
  async function setLastUpdated() {
    const data = await loadData();
    if (!data) return;
    document.querySelectorAll('.last-updated-date').forEach(el => {
      el.textContent = data.meta.lastUpdated;
    });
  }

  /* ================================================================
     12. COPY POSTAL CODE TO CLIPBOARD
     ================================================================ */
  function initCopyButtons() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const code = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(code);
        const original = btn.innerHTML;
        btn.innerHTML = '✅ ¡Copiado!';
        btn.style.background = 'var(--color-success)';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.innerHTML = original;
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      } catch {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    });
  }

  /* ================================================================
     13. SHARE FUNCTIONALITY
     ================================================================ */
  function initShareButtons() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-share]');
      if (!btn) return;
      const shareData = {
        title: document.title,
        text: document.querySelector('meta[name="description"]')?.content || '',
        url: location.href
      };
      if (navigator.share) {
        try { await navigator.share(shareData); } catch {}
      } else {
        // Fallback: copy URL
        try {
          await navigator.clipboard.writeText(location.href);
          btn.textContent = '✅ URL copiada';
          setTimeout(() => { btn.textContent = '🔗 Compartir'; }, 2000);
        } catch {}
      }
    });
  }

  /* ================================================================
     14. BACK NAVIGATION BUTTON (inside the page)
     ================================================================ */
  function initBackNavigation() {
    const path = location.pathname;
    if (!path.includes('country') && !path.includes('city') && !path.includes('guias') && !path.includes('about') && !path.includes('contacto') && !path.includes('metodologia') && !path.includes('privacidad') && !path.includes('terminos')) return;

    // Inject futuristic glow animation CSS
    const glowStyle = document.createElement('style');
    glowStyle.textContent = `
      @keyframes glow-rotate {
        0% { filter: hue-rotate(0deg); }
        100% { filter: hue-rotate(360deg); }
      }
      @keyframes border-glow {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      .back-nav-btn {
        position: fixed; top: 70px; left: 1rem; z-index: 50;
        display: flex; align-items: center; gap: .4rem;
        padding: .5rem 1rem .5rem .7rem;
        border: none; border-radius: 50px;
        background: rgba(12,18,34,.85);
        backdrop-filter: blur(16px);
        color: rgba(255,255,255,.85);
        cursor: pointer;
        font-family: var(--font-body); font-size: .82rem; font-weight: 600;
        letter-spacing: .02em;
        box-shadow: 0 2px 12px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.08);
        transition: all .35s cubic-bezier(.4,0,.2,1);
        opacity: 0; pointer-events: none;
        overflow: visible;
      }
      .back-nav-btn::before {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: 54px;
        background: linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899, #f59e0b, #10b981, #3b82f6);
        background-size: 300% 300%;
        opacity: 0;
        z-index: -1;
        transition: opacity .4s;
        animation: border-glow 4s ease infinite;
      }
      .back-nav-btn::after {
        content: '';
        position: absolute;
        inset: -8px;
        border-radius: 58px;
        background: linear-gradient(135deg, rgba(59,130,246,.3), rgba(139,92,246,.3), rgba(236,72,153,.3), rgba(245,158,11,.3), rgba(16,185,129,.3));
        background-size: 300% 300%;
        opacity: 0;
        z-index: -2;
        filter: blur(12px);
        transition: opacity .4s;
        animation: border-glow 4s ease infinite, glow-rotate 6s linear infinite;
      }
      .back-nav-btn:hover {
        color: #fff;
        background: rgba(12,18,34,.95);
        transform: translateX(2px) scale(1.03);
        box-shadow: 0 4px 20px rgba(59,130,246,.2), inset 0 1px 0 rgba(255,255,255,.12);
      }
      .back-nav-btn:hover::before { opacity: 1; }
      .back-nav-btn:hover::after { opacity: 1; }
      .back-nav-btn svg {
        transition: transform .3s;
      }
      .back-nav-btn:hover svg {
        transform: translateX(-3px);
      }
      .back-nav-btn .btn-text {
        background: linear-gradient(90deg, #fff, rgba(255,255,255,.7));
        -webkit-background-clip: text;
        background-clip: text;
        transition: all .3s;
      }
      .back-nav-btn:hover .btn-text {
        background: linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `;
    document.head.appendChild(glowStyle);

    const btn = document.createElement('button');
    btn.className = 'back-nav-btn';
    btn.setAttribute('aria-label', 'Volver a la página anterior');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span class="btn-text">Volver</span>
    `;
    document.body.appendChild(btn);

    // Show after small scroll
    let visible = false;
    window.addEventListener('scroll', () => {
      const show = window.scrollY > 100;
      if (show !== visible) {
        visible = show;
        btn.style.opacity = show ? '1' : '0';
        btn.style.pointerEvents = show ? 'auto' : 'none';
      }
    }, { passive: true });

    if (window.history.length > 1) {
      setTimeout(() => {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }, 500);
    }

    btn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        location.href = 'index.html';
      }
    });
  }

  /* ================================================================
     15. BACK TO TOP BUTTON
     ================================================================ */
  function initBackToTop() {
    const btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Volver arriba');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    btn.style.cssText = `
      position:fixed;bottom:1.5rem;right:1.5rem;z-index:50;
      width:44px;height:44px;border:none;border-radius:50%;
      background:var(--color-primary);color:#fff;cursor:pointer;
      box-shadow:var(--shadow-lg);opacity:0;pointer-events:none;
      transition:opacity .3s,transform .3s;
      display:flex;align-items:center;justify-content:center;
    `;
    document.body.appendChild(btn);

    // Add CSS animation for click markers on map
    const markerStyle = document.createElement('style');
    markerStyle.textContent = `
      @keyframes pulse-marker {
        0% { box-shadow: 0 0 0 0 rgba(245,158,11,.4); }
        70% { box-shadow: 0 0 0 12px rgba(245,158,11,0); }
        100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
      }
    `;
    document.head.appendChild(markerStyle);

    let visible = false;
    window.addEventListener('scroll', () => {
      const show = window.scrollY > 400;
      if (show !== visible) {
        visible = show;
        btn.style.opacity = show ? '1' : '0';
        btn.style.pointerEvents = show ? 'auto' : 'none';
        btn.style.transform = show ? 'translateY(0)' : 'translateY(10px)';
      }
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ================================================================
     15. SMOOTH REVEAL ANIMATIONS (Intersection Observer)
     ================================================================ */
  function initScrollAnimations() {
    if (!('IntersectionObserver' in window)) return;

    const style = document.createElement('style');
    style.textContent = `
      .reveal { opacity: 0; transform: translateY(20px); transition: opacity .6s ease, transform .6s ease; }
      .reveal.visible { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);

    // Add reveal class to animatable elements
    document.querySelectorAll('.country-card, .info-card, .city-item, .faq-item, .related-card').forEach(el => {
      el.classList.add('reveal');
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  /* ================================================================
     16. READING TIME ESTIMATION (for city pages)
     ================================================================ */
  function estimateReadingTime() {
    const content = document.getElementById('main-content');
    if (!content) return;
    const text = content.textContent || '';
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.ceil(words / 200));
    const el = document.getElementById('reading-time');
    if (el) el.textContent = `${minutes} min de lectura`;
  }


  /* ================================================================
     17. GAMES v6 – Fully robust, works on both index & juegos.html
     ================================================================ */

  // Define CP_GAMES stub IMMEDIATELY so buttons never fail silently
  window.CP_GAMES = window.CP_GAMES || {};

  function initGames() {
    if (!DATA) {
      console.error('CP_GAMES: No DATA loaded');
      ['quiz-inline','daily-inline','geopostal-question'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '<p style="text-align:center;color:var(--color-accent);padding:1rem">⚠️ Error cargando datos. <a href="javascript:location.reload()" style="color:var(--color-primary);font-weight:600">Reintentar</a></p>';
      });
      return;
    }

    console.log('CP_GAMES: Initializing with', DATA.countries.length, 'countries');

    // --- Glow styles ---
    try {
      var gs=document.createElement('style');
      gs.textContent='.game-card-glow{position:relative;overflow:visible;transition:all .4s}.game-card-glow::before{content:"";position:absolute;inset:-3px;border-radius:20px;background:linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899,#f59e0b,#10b981,#3b82f6);background-size:300% 300%;opacity:0;z-index:-1;animation:border-glow 4s ease infinite;transition:opacity .4s}.game-card-glow::after{content:"";position:absolute;inset:-10px;border-radius:24px;background:linear-gradient(135deg,rgba(59,130,246,.2),rgba(139,92,246,.2),rgba(236,72,153,.2),rgba(245,158,11,.2));background-size:300% 300%;opacity:0;z-index:-2;filter:blur(15px);animation:border-glow 4s ease infinite;transition:opacity .4s}.game-card-glow:hover{transform:translateY(-6px) scale(1.02)}.game-card-glow:hover::before{opacity:1}.game-card-glow:hover::after{opacity:1}.game-card-glow:hover .game-icon{transform:scale(1.2) rotate(-8deg)}.game-icon{transition:transform .5s cubic-bezier(.34,1.56,.64,1)}.fact-glow{position:relative;overflow:visible;transition:all .4s}.fact-glow::before{content:"";position:absolute;inset:-3px;border-radius:20px;background:linear-gradient(135deg,#f59e0b,#ec4899,#8b5cf6,#3b82f6,#10b981,#f59e0b);background-size:300% 300%;opacity:.4;z-index:-1;animation:border-glow 5s ease infinite;transition:opacity .4s}.fact-glow::after{content:"";position:absolute;inset:-8px;border-radius:24px;background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(236,72,153,.15),rgba(59,130,246,.15));background-size:300% 300%;opacity:.3;z-index:-2;filter:blur(12px);animation:border-glow 5s ease infinite}.fact-glow:hover::before{opacity:.7}.fact-glow:hover::after{opacity:.5}#dato-curioso-text{transition:all .5s cubic-bezier(.4,0,.2,1)}@keyframes fact-entrance{0%{opacity:0;transform:translateY(15px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}.fact-animate{animation:fact-entrance .5s cubic-bezier(.22,1,.36,1) forwards}';
      document.head.appendChild(gs);
      document.querySelectorAll('[data-game-card]').forEach(function(el){el.classList.add('game-card-glow')});
      document.querySelectorAll('[data-fact-card]').forEach(function(el){el.classList.add('fact-glow')});
    } catch(e){ console.error('CP_GAMES: Glow styles error', e); }

    // --- Build allCities array ---
    var allCities=[];
    try {
      DATA.countries.forEach(function(c){
        c.cities.forEach(function(city){
          allCities.push({
            name: city.name,
            postalCode: city.postalCode,
            postalRange: city.postalRange,
            state: city.state,
            lat: city.lat,
            lng: city.lng,
            country: c.name,
            countryId: c.id,
            flag: c.flag
          });
        });
      });
      console.log('CP_GAMES: Built allCities with', allCities.length, 'cities');
    } catch(e){ console.error('CP_GAMES: allCities error', e); }

    // ========== FACTS ==========
    var facts=["El ZIP de USA significa 'Zone Improvement Plan' (1963).","Brasil tiene 900.000+ CEPs, el más extenso de Latinoamérica.","El código 90210 de Beverly Hills es el más famoso por la TV.","En Nicaragua las direcciones usan 'de donde fue el árbol, 2 cuadras al lago'.","Los chasquis incas enviaban mensajes 2.500 km en 5 días.","En La Guajira, Colombia, usan burros para entregar correo.","Los pulpos tienen 3 corazones y sangre azul.","Las hormigas cargan 50x su peso.","Los delfines duermen con un ojo abierto.","El corazón de una ballena azul es enorme: un niño cabría en sus arterias.","Las nutrias se toman de las manos al dormir.","Las abejas reconocen rostros humanos.","Canadá tiene más lagos que todos los países combinados.","Australia es más ancha que la Luna.","Colombia tiene 1.900+ especies de aves, más que cualquier país.","Chile cubriría de Portugal a Ucrania.","El café fue descubierto por cabras hiperactivas en Etiopía.","El chocolate era moneda azteca: 10 granos = 1 conejo.","La pizza hawaiana la inventó un griego en Canadá.","Los bananos son bayas pero las fresas no.","Tu cuerpo tiene más bacterias que células humanas.","La miel nunca caduca. Encontraron miel de 3.000 años comestible.","Un rayo es 5x más caliente que el Sol.","Tu celular tiene más poder que toda la NASA en 1969.","Cleopatra vivió más cerca de la Luna que de las pirámides.","Oxford es más antigua que el Imperio Azteca.","'Salario' viene del latín 'sal': los romanos pagaban con sal.","Hay más estrellas que granos de arena en todas las playas.","Un día en Venus dura más que un año en Venus.","Los koalas tienen huellas dactilares casi iguales a las humanas.","En Suiza es ilegal tener solo un conejillo de indias.","La Torre Eiffel crece 15 cm en verano.","Tu nariz recuerda 50.000 olores.","En el espacio las lágrimas flotan como burbujas.","Saturno flotaría en agua.","La huella de Armstrong durará millones de años en la Luna.","Finlandia tiene más saunas que autos.","Si doblas papel 42 veces llegaría a la Luna.","Bolivia tiene 37 idiomas oficiales.","Islandia no tiene ejército ni McDonald's.","Reír 100 veces = 10 min en bicicleta.","Los bebés tienen 300 huesos, adultos 206.","El ojo del avestruz es más grande que su cerebro.","Los gatos duermen 70% de su vida.","México consume más Coca-Cola per cápita que nadie.","Las zanahorias eran moradas antes del siglo XVII.","Japón tiene más mascotas que niños menores de 15.","Rusia tiene 11 zonas horarias.","El queso Pule (leche de burra) cuesta $1.000/kg.","El 90% de la data mundial se creó en los últimos 2 años."];
    var sf=[...facts].sort(function(){return Math.random()-.5}),fi=0;

    try {
      document.querySelectorAll('#dato-curioso-text').forEach(function(el){el.textContent=sf[0]});
    } catch(e){ console.error('CP_GAMES: Facts display error', e); }

    function nextFact(){
      try {
        fi++;if(fi>=sf.length){sf=[...facts].sort(function(){return Math.random()-.5});fi=0}
        document.querySelectorAll('#dato-curioso-text').forEach(function(el){
          el.classList.remove('fact-animate');
          el.style.opacity='0';el.style.transform='translateY(15px) scale(.97)';
          setTimeout(function(){
            el.textContent=sf[fi];
            el.classList.add('fact-animate');
          },300);
        });
      } catch(e){ console.error('CP_GAMES: nextFact error', e); }
    }

    // ========== QUIZ ==========
    var qs=0,qq=0,qt=5;
    function quiz(tid){
      try {
        var t=document.getElementById(tid);if(!t){console.error('CP_GAMES: quiz target not found:',tid);return}
        if(qq>=qt){
          var p=Math.round(qs/qt*100),em=p>=80?'🏆':p>=60?'👏':'📚';
          t.innerHTML='<div style="text-align:center;padding:1rem"><div style="font-size:3rem">'+em+'</div><h3>¡Quiz terminado!</h3><p style="font-size:1.5rem;font-weight:700;color:var(--color-primary);margin:.5rem 0">'+qs+'/'+qt+'</p><button onclick="window.CP_GAMES.quizStart(\''+tid+'\')" style="padding:.6rem 1.5rem;border:none;border-radius:99px;background:var(--color-primary);color:#fff;cursor:pointer;font-weight:600;margin-top:.5rem">🔄 Jugar de nuevo</button></div>';
          return;
        }
        var c=allCities[Math.floor(Math.random()*allCities.length)];
        var wr=DATA.countries.filter(function(x){return x.name!==c.country}).sort(function(){return Math.random()-.5}).slice(0,3);
        var opts=[{n:c.country,f:c.flag,ok:true}].concat(wr.map(function(w){return{n:w.name,f:w.flag,ok:false}})).sort(function(){return Math.random()-.5});
        t.innerHTML='<div><div style="display:flex;justify-content:space-between;margin-bottom:1rem"><span style="color:var(--color-text-muted);font-size:.85rem">Pregunta '+(qq+1)+'/'+qt+'</span><span style="font-family:var(--font-mono);font-weight:700;color:var(--color-primary)">Pts: '+qs+'</span></div><h3 style="text-align:center">¿De qué país es este código?</h3><div style="text-align:center;font-family:var(--font-mono);font-size:2rem;font-weight:700;color:var(--color-primary);padding:1rem;background:rgba(30,64,175,.06);border-radius:12px;margin:1rem 0">'+c.postalCode+'</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">'+opts.map(function(o){return'<button data-ok="'+o.ok+'" style="padding:.75rem;border:2px solid var(--color-border);border-radius:8px;background:#fff;cursor:pointer;font-size:.95rem;font-weight:600;transition:all .2s;display:flex;align-items:center;gap:.5rem;justify-content:center">'+o.f+' '+o.n+'</button>'}).join('')+'</div><p style="text-align:center;margin-top:.75rem;font-size:.82rem;color:var(--color-text-muted)">Pista: '+c.name+', '+c.state+'</p></div>';
        t.querySelectorAll('button[data-ok]').forEach(function(b){b.onclick=function(){
          var ok=b.dataset.ok==='true';
          t.querySelectorAll('button[data-ok]').forEach(function(x){x.style.pointerEvents='none';if(x.dataset.ok==='true'){x.style.borderColor='#10b981';x.style.background='rgba(16,185,129,.1)'}else if(x===b&&!ok){x.style.borderColor='#ef4444';x.style.background='rgba(239,68,68,.1)'}});
          if(ok)qs++;qq++;setTimeout(function(){quiz(tid)},1200);
        }});
      } catch(e){ console.error('CP_GAMES: quiz error', e); }
    }
    function quizStart(tid){qs=0;qq=0;quiz(tid)}
    function quizModal(){qs=0;qq=0;var m=document.getElementById('quiz-modal');if(m){m.style.display='flex';document.body.style.overflow='hidden'}quiz('quiz-content')}
    function closeQuiz(){var m=document.getElementById('quiz-modal');if(m){m.style.display='none';document.body.style.overflow=''}}

    // ========== DAILY (5 ROUNDS) ==========
    var ds=0,dq=0,dTotal=5;
    function daily(tid){
      try {
        var t=document.getElementById(tid);if(!t){console.error('CP_GAMES: daily target not found:',tid);return}
        if(dq>=dTotal){
          t.innerHTML='<div style="text-align:center;padding:1rem"><div style="font-size:3rem">'+(ds>=4?'🏆':ds>=3?'👏':'🌍')+'</div><h3>¡Reto completado!</h3><p style="font-size:1.3rem;font-weight:700;color:var(--color-primary);margin:.5rem 0">Adivinaste '+ds+' de '+dTotal+' ciudades</p><button onclick="window.CP_GAMES.dailyStart(\''+tid+'\')" style="padding:.6rem 1.5rem;border:none;border-radius:99px;background:var(--color-accent);color:#fff;cursor:pointer;font-weight:600;margin-top:.5rem">🔄 Intentar de nuevo</button></div>';
          return;
        }
        var city=allCities[(Math.floor(Date.now()/86400000)+dq)%allCities.length];
        var hints=['País: '+city.flag+' ???','Estado: '+city.state,'País: '+city.flag+' '+city.country];
        var hl=0;
        t.innerHTML='<div style="text-align:center"><div style="display:flex;justify-content:space-between;margin-bottom:.5rem"><span style="font-size:.85rem;color:var(--color-text-muted)">Ciudad '+(dq+1)+' de '+dTotal+'</span><span style="font-weight:700;color:var(--color-primary)">Aciertos: '+ds+'</span></div><h3 style="font-size:1.1rem;margin-bottom:.5rem">📅 ¿Qué ciudad tiene este código?</h3><div style="font-family:var(--font-mono);font-size:2.2rem;font-weight:700;color:var(--color-primary);padding:1.2rem;background:rgba(30,64,175,.06);border-radius:12px;margin:1rem 0">'+city.postalCode+'</div><input type="text" id="di-'+tid+'" placeholder="Escribe la ciudad..." style="width:100%;padding:.75rem;border:2px solid var(--color-border);border-radius:8px;font-size:1rem;text-align:center;margin-bottom:.5rem"><div id="dr-'+tid+'" style="min-height:1.5rem;margin-bottom:.5rem"></div><div id="dh-'+tid+'" style="min-height:30px;display:flex;flex-direction:column;gap:.3rem;margin-bottom:1rem;text-align:left"></div><div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap"><button id="dc-'+tid+'" style="padding:.5rem 1.2rem;border:none;border-radius:99px;background:var(--color-primary);color:#fff;cursor:pointer;font-weight:600;font-size:.88rem">✓ Verificar</button><button id="dhb-'+tid+'" style="padding:.5rem 1.2rem;border:1px solid var(--color-accent);border-radius:99px;background:#fff;cursor:pointer;font-weight:600;font-size:.88rem;color:var(--color-accent)">💡 Pista ('+hints.length+')</button><button id="ds-'+tid+'" style="padding:.5rem 1.2rem;border:1px solid var(--color-border);border-radius:99px;background:#fff;cursor:pointer;font-weight:600;font-size:.88rem;color:var(--color-text-muted)">Saltar →</button></div></div>';

        var inp=document.getElementById('di-'+tid);
        var res=document.getElementById('dr-'+tid);

        function checkAnswer(){
          if(!inp||!res)return;
          var a=inp.value.trim().toLowerCase();
          if(a.length<2){res.innerHTML='<span style="color:var(--color-accent);font-size:.85rem">Escribe al menos 2 letras</span>';return}
          var cn=city.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
          var an=a.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
          if(cn.includes(an)||an.includes(cn.split(' ')[0])){
            ds++;dq++;
            res.innerHTML='<span style="color:#10b981;font-weight:700">🎉 ¡Correcto! '+city.flag+' '+city.name+'</span>';
            inp.disabled=true;inp.style.borderColor='#10b981';
            setTimeout(function(){daily(tid)},1500);
          } else {
            res.innerHTML='<span style="color:#ef4444;font-size:.85rem">❌ Intenta de nuevo o usa una pista</span>';
            inp.style.borderColor='#ef4444';
            setTimeout(function(){if(inp)inp.style.borderColor='var(--color-border)'},1500);
          }
        }
        var dcBtn=document.getElementById('dc-'+tid);
        if(dcBtn) dcBtn.addEventListener('click',checkAnswer);
        if(inp) inp.addEventListener('keydown',function(e){if(e.key==='Enter')checkAnswer()});

        var dsBtn=document.getElementById('ds-'+tid);
        if(dsBtn) dsBtn.addEventListener('click',function(){
          dq++;res.innerHTML='<span style="color:var(--color-text-muted);font-size:.85rem">Era: '+city.flag+' '+city.name+', '+city.country+'</span>';
          inp.disabled=true;setTimeout(function(){daily(tid)},1500);
        });

        var dhbBtn=document.getElementById('dhb-'+tid);
        if(dhbBtn) dhbBtn.addEventListener('click',function(){
          if(hl<hints.length){
            document.getElementById('dh-'+tid).innerHTML+='<div style="padding:.4rem .7rem;background:rgba(245,158,11,.06);border-radius:6px;font-size:.88rem;border-left:3px solid var(--color-accent)">'+hints[hl]+'</div>';
            hl++;this.textContent=hl>=hints.length?'✅ Sin pistas':'💡 Pista ('+(hints.length-hl)+')';
            if(hl>=hints.length)this.disabled=true;
          }
        });
      } catch(e){ console.error('CP_GAMES: daily error', e); }
    }
    function dailyStart(tid){ds=0;dq=0;daily(tid)}
    function dailyModal(){ds=0;dq=0;var m=document.getElementById('daily-modal');if(m){m.style.display='flex';document.body.style.overflow='hidden'}daily('daily-content')}
    function closeDaily(){var m=document.getElementById('daily-modal');if(m){m.style.display='none';document.body.style.overflow=''}}

    // ========== GEOPOSTAL ==========
    var gM=null,gS=0,gR=0,gT=5,gC=null,gRetry=0;
    function geo(){
      try {
        var el=document.getElementById('geopostal-map');
        if(!el){
          location.href='juegos.html';
          return;
        }
        if(typeof L==='undefined'){
          gRetry++;
          if(gRetry>10){
            var q=document.getElementById('geopostal-question');
            if(q) q.innerHTML='<p style="text-align:center;color:var(--color-accent);padding:1rem">⚠️ Error cargando el mapa. <a href="javascript:location.reload()" style="color:var(--color-primary);font-weight:600">Reintentar</a></p>';
            return;
          }
          setTimeout(geo,500);return;
        }
        gRetry=0;gS=0;gR=0;
        if(gM){try{gM.remove()}catch(ex){}gM=null}
        gM=L.map('geopostal-map',{scrollWheelZoom:true}).setView([10,-40],3);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(gM);
        setTimeout(function(){
          if(gM){gM.invalidateSize();geoNext()}
        },600);
      } catch(e){ console.error('CP_GAMES: geo init error', e); }
    }
    function geoNext(){
      try {
        if(!gM)return;
        if(gR>=gT){
          var mx=gT*1000,pc=Math.round(gS/mx*100);
          document.getElementById('geopostal-question').innerHTML='<div style="text-align:center"><div style="font-size:2rem">'+(pc>=70?'🏆':'🌍')+'</div><strong>Puntuación: '+gS+'/'+mx+' ('+pc+'%)</strong></div>';
          document.getElementById('geopostal-score').innerHTML='<button onclick="window.CP_GAMES.geo()" style="padding:.5rem 1.2rem;border:none;border-radius:99px;background:var(--color-primary);color:#fff;cursor:pointer;font-weight:600">🔄 Jugar de nuevo</button>';
          return;
        }
        gM.eachLayer(function(l){if(l instanceof L.Marker||l instanceof L.Polyline)gM.removeLayer(l)});
        gC=allCities[Math.floor(Math.random()*allCities.length)];
        gM.flyTo([10,-40],3,{duration:.8});
        document.getElementById('geopostal-question').innerHTML='<div style="display:flex;align-items:center;justify-content:center;gap:1rem;flex-wrap:wrap"><span style="font-size:.85rem;color:var(--color-text-muted)">Ronda '+(gR+1)+'/'+gT+'</span><span style="font-size:1.5rem">'+gC.flag+'</span><div><strong>'+gC.name+'</strong><br><span style="font-family:var(--font-mono);color:var(--color-primary);font-weight:700">'+gC.postalCode+'</span></div></div><p style="text-align:center;margin-top:.5rem;font-size:.85rem;color:var(--color-accent);font-weight:600">👆 Haz clic en el mapa donde está esta ciudad</p>';
        document.getElementById('geopostal-score').innerHTML='Puntos: '+gS;
        gM.once('click',function(e){
          try {
            var cL=e.latlng.lat,cG=e.latlng.lng,rL=gC.lat,rG=gC.lng;
            var d=Math.sqrt(Math.pow(cL-rL,2)+Math.pow(cG-rG,2)),dk=Math.round(d*111),pts=Math.max(0,Math.round(1000-d*100));
            gS+=pts;gR++;
            L.marker([cL,cG],{icon:L.divIcon({className:'',html:'<div style="width:14px;height:14px;background:#ef4444;border:2px solid #fff;border-radius:50%"></div>',iconSize:[14,14],iconAnchor:[7,7]})}).addTo(gM);
            L.marker([rL,rG],{icon:L.divIcon({className:'',html:'<div style="width:18px;height:18px;background:#10b981;border:3px solid #fff;border-radius:50%"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(gM).bindPopup(gC.flag+' '+gC.name).openPopup();
            L.polyline([[cL,cG],[rL,rG]],{color:'#3b82f6',weight:2,dashArray:'8,8'}).addTo(gM);
            gM.fitBounds([[cL,cG],[rL,rG]],{padding:[60,60],maxZoom:8});
            var em=pts>=800?'🎯':pts>=500?'👍':'🤔';
            document.getElementById('geopostal-question').innerHTML='<div style="text-align:center"><span style="font-size:1.5rem">'+em+'</span> <strong>+'+pts+' pts</strong> <span style="color:var(--color-text-muted)">~'+dk+' km</span></div>';
            setTimeout(geoNext,2500);
          } catch(ex){ console.error('CP_GAMES: geoNext click error', ex); }
        });
      } catch(e){ console.error('CP_GAMES: geoNext error', e); }
    }

    // ========== EXPOSE (always runs) ==========
    window.CP_GAMES = {
      nextFact: nextFact,
      quiz: quiz,
      quizStart: quizStart,
      quizModal: quizModal,
      closeQuiz: closeQuiz,
      daily: daily,
      dailyStart: dailyStart,
      dailyModal: dailyModal,
      closeDaily: closeDaily,
      geo: geo
    };

    console.log('CP_GAMES: Ready!', Object.keys(window.CP_GAMES));

    // Auto-start games on juegos.html page
    if (location.pathname.includes('juegos')) {
      console.log('CP_GAMES: Auto-binding juegos.html buttons');
      var quizBtn = document.getElementById('quiz-start-btn');
      if (quizBtn) quizBtn.addEventListener('click', function(){ quizStart('quiz-inline'); });

      var dailyBtn = document.getElementById('daily-start-btn');
      if (dailyBtn) dailyBtn.addEventListener('click', function(){ dailyStart('daily-inline'); });

      var geoBtn = document.getElementById('geopostal-btn');
      if (geoBtn) geoBtn.addEventListener('click', function(){ geo(); });

      var factBtn = document.getElementById('fact-next-btn');
      if (factBtn) factBtn.addEventListener('click', function(){ nextFact(); });
    }
  }

  function init() {
    initHeaderScroll();
    initMobileMenu();
    initCopyButtons();
    initShareButtons();
    initBackToTop();
    initBackNavigation();
    setLastUpdated();

    // Detect which page we're on
    const path = location.pathname;
    if (path.includes('country')) {
      renderCountry();
    } else if (path.includes('city')) {
      renderCity();
    } else if (path.includes('juegos')) {
      loadData().then(() => initGames());
    } else if (path.includes('index') || path.endsWith('/')) {
      renderHome().then(() => initGames());
    }

    // Delayed non-critical init
    requestAnimationFrame(() => {
      initScrollAnimations();
      estimateReadingTime();
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
