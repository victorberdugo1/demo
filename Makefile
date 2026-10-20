.PHONY: up down logs keys

up: .env
	docker compose up -d
	@echo "Open http://localhost:3000"

.env:
	@printf "GEMMA_API_KEY (Enter to skip): "; read gemma; \
	printf "ELEVENLABS_API_KEY (Enter to skip): "; read eleven; \
	printf "GEMMA_API_KEY=%s\nELEVENLABS_API_KEY=%s\n" "$$gemma" "$$eleven" > .env

keys:
	rm -f .env
	$(MAKE) .env

down:
	docker compose down

logs:
	docker compose logs -f
