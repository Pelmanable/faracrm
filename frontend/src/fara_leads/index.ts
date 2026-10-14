// Side-effect: регистрирует расширения модуля — блок «Исходный лид» в форме
// продаж, карточку лида в канбане и кнопку «Лиды» в форме партнёра.
// Подключается лениво из config/models.ts (modelsConfig.sales.extensions,
// modelsConfig.leads.extensions и modelsConfig.partners.extensions).
import './extensions/ViewFormSale';
import './extensions/KanbanCardLead';
import './extensions/ViewFormPartner';
