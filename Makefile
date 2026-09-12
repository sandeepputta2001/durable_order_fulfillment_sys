.PHONY: setup dev test lint format typecheck build docker-build up down restart logs migrate clean demo-fail demo-fix

## Install dependencies, create .env, and start infra (postgres/temporal/temporal-ui)
setup:
	npm install
	cp -n .env.example .env || true
	docker compose up -d postgres temporal temporal-ui
	@echo ""
	@echo "Waiting for Postgres to accept connections..."
	@until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	npm run migrate
	@echo ""
	@echo "Setup complete. Run 'make dev' to start the API and Worker locally."

## Run the API and Worker locally (against dockerized postgres/temporal) with hot reload
dev:
	npm run dev

## Run the automated test suite (requires postgres reachable on DATABASE_URL)
test:
	npm test

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

build:
	npm run build

## Build the production Docker images for api/worker
docker-build:
	docker compose build

## Start the full stack (postgres, temporal, temporal-ui, api, worker) in Docker
up:
	docker compose up --build -d
	@echo ""
	@echo "API:          http://localhost:8085"
	@echo "Temporal UI:  http://localhost:8081"
	@echo "Worker metrics: http://localhost:9464/metrics"

down:
	docker compose down

restart:
	docker compose restart api worker

logs:
	docker compose logs -f

## Apply SQL migrations against DATABASE_URL (defaults to .env)
migrate:
	npm run migrate

## Enable payment failure simulation and recreate the worker (see docs/FAILURE_SCENARIOS.md)
demo-fail:
	sed -i 's/^PAYMENT_FAILURE_MODE=.*/PAYMENT_FAILURE_MODE=true/' .env
	docker compose up -d worker

## Disable payment failure simulation and recreate the worker
demo-fix:
	sed -i 's/^PAYMENT_FAILURE_MODE=.*/PAYMENT_FAILURE_MODE=false/' .env
	docker compose up -d worker

clean:
	docker compose down -v
	rm -rf dist node_modules
