/**
 * Dev-only page (/ship-lab.html) for designing ship model specs.
 */
import { ShipViewer } from '../three/ships/ShipViewer.js';
import { getShipThumbnail } from '../three/ships/ShipThumbnails.js';
import { resolveModelSpec } from '../three/ships/ShipModelFactory.js';

const PRESETS = {
  lightFighter: { hull: 'fighter', faction: 'alliance', scale: 0.55 },
  heavyFighter: { hull: 'fighter', faction: 'empire', scale: 0.7, wings: 'swept' },
  cruiser: { hull: 'wedge', faction: 'alliance', scale: 1.4, engines: 2 },
  battleship: { hull: 'wedge', faction: 'alliance', scale: 2, engines: 4 },
  destroyer: { hull: 'wedge', faction: 'alliance', scale: 2.6, engines: 5, flagship: true },
  battlecruiser: { hull: 'lance', faction: 'empire', scale: 2.2, engines: 3 },
  bomber: { hull: 'lance', faction: 'empire', scale: 1.7, engines: 2, sponsons: 'heavy' },
  smallCargo: { hull: 'freighter', faction: 'civil', scale: 0.9, pods: 2 },
  largeCargo: { hull: 'freighter', faction: 'civil', scale: 1.4, pods: 4 },
  recycler: { hull: 'freighter', faction: 'civil', scale: 1.2, pods: 2, arms: true },
  colonyShip: { hull: 'colony', faction: 'civil', scale: 1.5 },
  espionageProbe: { hull: 'probe', faction: 'civil', scale: 0.5 },
  solarSatellite: { hull: 'satellite', faction: 'civil', scale: 0.8 },
  deathstar: { hull: 'fortress', faction: 'empire', scale: 4 }
};

const grid = document.getElementById('lab-grid');
const textarea = document.getElementById('lab-spec');
const errorEl = document.getElementById('lab-error');
const viewer = new ShipViewer(document.getElementById('lab-viewer'));
let currentKey = 'lightFighter';

function select(key, spec) {
  currentKey = key;
  textarea.value = JSON.stringify(spec, null, 2);
  grid.querySelectorAll('.lab-card').forEach((card) => card.classList.toggle('active', card.dataset.key === key));
  viewer.modelKey = null;
  viewer.show(resolveModelSpec({ model: spec }), key);
}

for (const [key, spec] of Object.entries(PRESETS)) {
  const card = document.createElement('button');
  card.className = 'lab-card';
  card.dataset.key = key;
  const img = document.createElement('img');
  img.alt = key;
  const label = document.createElement('div');
  label.textContent = `${key} · ${spec.hull}`;
  card.append(img, label);
  card.addEventListener('click', () => select(key, spec));
  grid.appendChild(card);
  getShipThumbnail(resolveModelSpec({ model: spec }), key).then((url) => { img.src = url; });
}

textarea.addEventListener('input', () => {
  try {
    const spec = JSON.parse(textarea.value);
    errorEl.textContent = '';
    viewer.modelKey = null;
    viewer.show(resolveModelSpec({ model: spec }), currentKey);
  } catch (error) {
    errorEl.textContent = error.message;
  }
});

const initial = new URLSearchParams(location.search).get('ship') || 'battleship';
select(initial, PRESETS[initial] || PRESETS.battleship);
