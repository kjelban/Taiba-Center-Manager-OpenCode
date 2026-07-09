import { COLLECTIONS, setData } from './base';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

export const CategoryService = {
  getCategories: async (): Promise<string[]> => {
    const catSnap = await getDoc(doc(db, COLLECTIONS.CATEGORIES, 'all'));
    if (catSnap.exists()) {
      return catSnap.data().items || [];
    }
    return [];
  },

  addCategory: async (category: string): Promise<void> => {
    const categories = await CategoryService.getCategories();
    if (!categories.includes(category)) {
      categories.push(category);
      await setData(COLLECTIONS.CATEGORIES, 'all', { items: categories });
    }
  },

  deleteCategory: async (category: string): Promise<void> => {
    const categories = await CategoryService.getCategories();
    const newCategories = categories.filter(c => c !== category);
    await setData(COLLECTIONS.CATEGORIES, 'all', { items: newCategories });
  },

  getSeasons: async (): Promise<string[]> => {
    const seasSnap = await getDoc(doc(db, COLLECTIONS.SEASONS, 'all'));
    if (seasSnap.exists()) {
      return seasSnap.data().items || [];
    }
    return [];
  },

  addSeason: async (season: string): Promise<void> => {
    const seasons = await CategoryService.getSeasons();
    if (!seasons.includes(season)) {
      seasons.push(season);
      await setData(COLLECTIONS.SEASONS, 'all', { items: seasons });
    }
  },

  deleteSeason: async (season: string): Promise<void> => {
    const seasons = await CategoryService.getSeasons();
    const newSeasons = seasons.filter(s => s !== season);
    await setData(COLLECTIONS.SEASONS, 'all', { items: newSeasons });
  },
};
