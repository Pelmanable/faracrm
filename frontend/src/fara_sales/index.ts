// Side-effect: регистрирует карточку заказа в канбане и кнопку «Заказы» в
// форме партнёра. Подключается лениво из config/models.ts
// (modelsConfig.sales.extensions и modelsConfig.partners.extensions).
import './extensions/KanbanCardSale';
import './extensions/ViewFormPartner';
