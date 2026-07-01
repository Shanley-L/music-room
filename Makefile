.PHONY: up down re build logs status api-health api-test db-push api-test-license

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

api-test-license:
	$(COMPOSE) exec api node -e "\
	  const h={'Content-Type':'application/json','X-Dev-User-Id':'bob'};\
	  fetch('http://127.0.0.1:3000/api/rooms',{method:'POST',headers:{...h,'X-Dev-User-Id':'alice'},body:JSON.stringify({name:'Invite only',visibility:'PUBLIC',license:'INVITED_ONLY'})})\
	  .then(r=>r.json()).then(room=>fetch('http://127.0.0.1:3000/api/rooms/'+room.id+'/tracks',{method:'POST',headers:h,body:JSON.stringify({externalId:'1',title:'A',artist:'B'})}).then(()=>room))\
	  .then(room=>fetch('http://127.0.0.1:3000/api/rooms/'+room.id+'/tracks',{method:'GET',headers:h}).then(r=>r.json()).then(tracks=>fetch('http://127.0.0.1:3000/api/rooms/'+room.id+'/tracks/'+tracks[0].id+'/vote',{method:'POST',headers:h})))\
	  .then(r=>r.json().then(d=>console.log('bob sans invite:',d)))"