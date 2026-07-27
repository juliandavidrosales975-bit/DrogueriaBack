import {
  ProductUnitRepository,
  CreateProductUnitInput,
  UpdateProductUnitInput,
} from './product-unit.repository';
import { ProductRepository } from './product.repository';
import { ApiError } from '@shared/errors/ApiError';

export class ProductUnitService {
  private unitRepo = new ProductUnitRepository();
  private productRepo = new ProductRepository();

  async list(productId: string) {
    return this.unitRepo.findByProductId(productId);
  }

  async create(input: CreateProductUnitInput) {
    // product_units están asociadas a un producto que debe existir en la misma tienda
    const product = await this.productRepo.findById(input.productId, input.storeId);
    if (!product) {
      throw ApiError.notFound('Producto no encontrado');
    }

    if (input.factor <= 1) {
      throw ApiError.badRequest('El factor debe ser mayor a 1 (ej. 10 para una caja x10)');
    }

    if (input.cost < 0) {
      throw ApiError.badRequest('El costo no puede ser negativo');
    }

    if (input.barcode) {
      const existing = await this.unitRepo.findByBarcode(input.barcode, input.storeId);
      if (existing) {
        throw ApiError.badRequest('El código de barras ya está en uso por otra presentación');
      }
    }

    return this.unitRepo.create(input);
  }

  async update(id: string, input: UpdateProductUnitInput, storeId: string) {
    const existing = await this.unitRepo.findById(id);
    if (!existing) {
      throw ApiError.notFound('Presentación no encontrada');
    }

    if (input.factor !== undefined && input.factor <= 1) {
      throw ApiError.badRequest('El factor debe ser mayor a 1 (ej. 10 para una caja x10)');
    }

    if (input.cost !== undefined && input.cost < 0) {
      throw ApiError.badRequest('El costo no puede ser negativo');
    }

    if (input.barcode) {
      const existingBarcode = await this.unitRepo.findByBarcode(input.barcode, storeId);
      if (existingBarcode && existingBarcode.id !== id) {
        throw ApiError.badRequest('El código de barras ya está en uso por otra presentación');
      }
    }

    return this.unitRepo.update(id, input);
  }

  async remove(id: string) {
    const existing = await this.unitRepo.findById(id);
    if (!existing) {
      throw ApiError.notFound('Presentación no encontrada');
    }
    await this.unitRepo.delete(id);
  }
}
