// Compatibility for existing ship inspectors; browsers share ModelViewer instead.
import { ModelViewer } from '../entities/ModelViewer.js';
import { createShipModel, disposeShipModel } from './ShipModelFactory.js';
export { createStudio } from '../entities/Studio.js';
export class ShipViewer extends ModelViewer {
  show(spec, key) {
    super.show(spec, key, createShipModel, disposeShipModel);
  }
}
