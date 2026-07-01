.PHONY: up down re build logs status api-health api-test db-push

COMPOSE = docker compose -f docker-compose.yml

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

re:
	-$(COMPOSE) down -v
	
	$(MAKE) up

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps

db-push:
	$(COMPOSE) exec api npx prisma db push

api-health:
	$(COMPOSE) exec api node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(console.log)"

api-test:
	$(COMPOSE) exec api node -e "\
	  fetch('http://127.0.0.1:3000/api/rooms',{method:'POST',headers:{'Content-Type':'application/json','X-Dev-User-Id':'alice'},body:JSON.stringify({name:'Test',visibility:'PUBLIC'})})\
	  .then(r=>r.json()).then(console.log)"

clean:
	$(COMPOSE) down -v
	rm -rf App/node_modules
	rm -rf Api/node_modules