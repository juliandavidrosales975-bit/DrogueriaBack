import { CategoryRepository, CreateCategoryInput } from './category.repository';
import { ApiError } from '@shared/errors/ApiError';

export class CategoryService {
  private categoryRepo = new CategoryRepository();

  async list(storeId: string) {
    return this.categoryRepo.findAll(storeId);
  }

  async create(input: CreateCategoryInput, storeId: string) {
    const existing = await this.categoryRepo.findByName(input.name, storeId);
    if (existing) {
      throw ApiError.badRequest('La categoría ya existe');
    }
    return this.categoryRepo.create(input, storeId);
  }
}
