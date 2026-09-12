-- Runs once when the postgres container's data volume is first
-- initialized (docker-entrypoint-initdb.d convention). Creates the
-- application's own database/role, separate from the "postgres"
-- superuser database that Temporal's auto-setup container uses for its
-- own `temporal` and `temporal_visibility` schemas.
CREATE USER order_user WITH PASSWORD 'order_pass';
CREATE DATABASE order_system OWNER order_user;
GRANT ALL PRIVILEGES ON DATABASE order_system TO order_user;
