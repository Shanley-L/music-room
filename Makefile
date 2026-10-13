.PHONY: up down re fclean build logs status env test test-db load load-api load-clean

API_ENV = Api/.env

# Host ports (POSTGRES_PORT, REDIS_PORT, API_PORT, ...) are read from Api/.env when
# it exists, otherwise docker-compose.yml defaults apply. Checked when the recipe
# runs (not when make parses this file), so `up` sees the file `env` just created.
COMPOSE = docker compose -f docker-compose.yml $$([ -f $(API_ENV) ] && echo --env-file $(API_ENV))

up: env
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

fclean:
	-$(COMPOSE) down -v --remove-orphans
	-$(COMPOSE) rm -f
	docker volume prune -f
	docker image prune -f

re: fclean
	$(MAKE) up

build: env
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps

# Creates Api/.env from Api/.env.example with random JWT secrets (never overwrites it).
env: $(API_ENV)

$(API_ENV):
	cp Api/.env.example $(API_ENV)
	sed -i "s/^JWT_SECRET=.*/JWT_SECRET=\"$$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')\"/" $(API_ENV)
	sed -i "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=\"$$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')\"/" $(API_ENV)
	@echo "Created $(API_ENV) with random JWT secrets; review the ports and credentials in it."

# Pushes the Prisma schema to TEST_DATABASE_URL (the test database must exist).
test-db: env
	cd Api && { [ -d node_modules ] || npm ci; }
	cd Api && DATABASE_URL="$$(grep -E '^TEST_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')" npx prisma db push

# API test suite (needs Postgres at TEST_DATABASE_URL and Redis, e.g. `make up`).
test: env
	cd Api && { [ -d node_modules ] || npm ci; }
	cd Api && npx prisma generate >/dev/null
	cd Api && npm test

# --- Load tests (see load/README.md and docs/LOAD_TESTING.md) ---
# Everything runs against TEST_DATABASE_URL: the seed wipes it.
LOAD_TEST_DB = $$(grep -E '^TEST_DATABASE_URL=' $(CURDIR)/$(API_ENV) | cut -d= -f2- | tr -d '"')
VUS ?= 100

# API in production mode on the test database, rate limits raised for a single
# load-generating IP (env overrides only, no code change). Logs go to load/results/api.log.
load-api: env
	@test -n "$(LOAD_TEST_DB)" || { echo "TEST_DATABASE_URL is not set in $(API_ENV)"; exit 1; }
	cd Api && { [ -d node_modules ] || npm ci; }
	cd Api && npx prisma generate >/dev/null
	mkdir -p load/results
	cd Api && DATABASE_URL="$(LOAD_TEST_DB)" NODE_ENV=production \
		RATE_LIMIT_API_MAX=1000000000 RATE_LIMIT_VOTE_MAX=1000000000 \
		node src/server.js > ../load/results/api.log 2>&1

# Seeds VUS users and runs the three scenarios (k6, or the grafana/k6 image if k6 is missing).
load: env
	cd Api && { [ -d node_modules ] || npm ci; }
	VUS=$(VUS) ./load/run.sh

load-clean: env
	node load/seed.js clean
