.PHONY: up down build logs status

# Use system `docker-compose` if available, otherwise fall back to `docker compose`.
DOCKER_COMPOSE := $(shell command -v docker-compose >/dev/null 2>&1 && echo docker-compose || echo docker\ compose)
COMPOSE = $(DOCKER_COMPOSE) -f docker-compose.yml

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps
