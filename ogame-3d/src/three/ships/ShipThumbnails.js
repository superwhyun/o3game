import { getModelThumbnail } from '../entities/ModelThumbnails.js';
import { createShipModel, disposeShipModel } from './ShipModelFactory.js';
export function getShipThumbnail(spec, key) {
  return getModelThumbnail(spec, key, createShipModel, disposeShipModel);
}
