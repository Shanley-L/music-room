.PHONY: up down re fclean build logs status test-load test-load-k6 test-load-autocannon test-load-ab

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

test-load: test-load-k6

test-load-k6:
	./load-tests/run-k6.sh

test-load-autocannon:
	node load-tests/autocannon-suite.js

test-load-ab:
	./load-tests/ab-test.sh