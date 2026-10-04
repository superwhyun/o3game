import { apiService } from '../services/ApiService.js';
import { catalog } from '../data/catalog.js';
import { acquireViewer } from '../three/entities/ModelViewer.js';
import { getModelThumbnail } from '../three/entities/ModelThumbnails.js';
import {
  createEntityModel,
  disposeEntityModel,
} from '../three/entities/EntityModels.js';
import {
  visualSpec,
  visualKey,
  BUILDING_TIERS,
} from '../three/entities/visualRules.js';
import { escapeHtml } from '../ui/dom.js';
try {
  await catalog.load(apiService);
  const grid = document.querySelector('#entity-grid');
  const viewer = acquireViewer(document.querySelector('#entity-viewer'));
  viewer.setInteractive(true);
  for (const type of ['building', 'research'])
    for (const entity of catalog.list(type)) {
      if (type === 'building') {
        const title = document.createElement('h2');
        title.className = 'lab-title';
        title.textContent = entity.name;
        grid.append(title);
      }
      for (let tier = 0; tier < (type === 'building' ? 4 : 1); tier++) {
        const spec = visualSpec(
            entity,
            type === 'building' ? BUILDING_TIERS[tier].min : 1,
            tier,
          ),
          key = visualKey(entity, spec);
        const button = document.createElement('button');
        button.className = 'lab-card';
        button.dataset.variant = key;
        button.innerHTML = `<img alt="${escapeHtml(entity.name)}"><strong>${escapeHtml(entity.name)}</strong><p>${type === 'building' ? BUILDING_TIERS[tier].name + ' · Lv ' + BUILDING_TIERS[tier].min : '研究 · 実験'}</p>`;
        grid.append(button);
        button.addEventListener('click', () => {
          viewer.show(spec, key, createEntityModel, disposeEntityModel);
        });
        getModelThumbnail(spec, key, createEntityModel, disposeEntityModel)
          .then((url) => {
            button.querySelector('img').src = url;
          })
          .catch((error) => {
            document.querySelector('#lab-error').textContent = error.message;
          });
        if (!viewer.model)
          viewer.show(spec, key, createEntityModel, disposeEntityModel);
      }
    }
} catch (error) {
  document.querySelector('#lab-error').textContent = error.message;
}
