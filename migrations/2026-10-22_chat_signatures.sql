-- Личные подписи сотрудников по коннекторам чата.
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_signatures JSONB;
