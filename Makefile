.PHONY: up down re fclean build logs status

COMPOSE = docker compose -f docker-compose.yml

up:
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

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps