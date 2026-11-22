.PHONY: up down seed test bench bench-docker

up:
	docker compose up -d --build

down:
	docker compose down -v

seed:
	DATABASE_URL=postgres://reporting:reporting_dev_password@localhost:5433/tx_reporting ROW_COUNT=1000000 npm run seed

test:
	npm test

bench:
	k6 run k6/query-load.js

# Runs k6 inside the compose network (bypasses host port forwarding).
bench-docker:
	docker run --rm -i --network tx-query-reporting-engine_default \
		-e API_URL=http://app:3001 \
		-v $(CURDIR)/k6:/scripts:ro \
		grafana/k6 run /scripts/query-load.js
