.PHONY: up down re build logs status api-health api-test db-push clean fclean

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

# clean:
# 	$(COMPOSE) down -v
# 	rm -rf App/node_modules
# 	rm -rf Api/node_modules

clean:
	@echo "Cleaning containers..."
	@$(COMPOSE) stop $(QUIET)
	@$(COMPOSE) down $(QUIET)
	@echo "Containers stopped and removed."

fclean: clean
	@echo "Deep cleaning..."
	@$(COMPOSE) down -v --rmi all $(QUIET)
	@rm -rf App/node_modules Api/node_modules
	@rm -f App/package-lock.json Api/package-lock.json
	@echo "Everything has been deleted."