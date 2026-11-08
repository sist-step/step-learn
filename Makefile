MOODLE_PLUGIN_DIR := moodle/local_steplearn
MOODLE_PLUGIN_NAME := steplearn
MOODLE_ZIP := moodle/local_steplearn.zip

.PHONY: help moodle-zip moodle-zip-clean
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

help: ## コマンドの一覧を表示する
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

# ファイルの更新日時で差分ビルドにしないのは、削除したファイルが zip に残ってしまうため
moodle-zip: ## Moodle プラグインを moodle/local_steplearn.zip にまとめる
	rm -f $(MOODLE_ZIP)
	tmp=$$(mktemp -d) && trap 'rm -rf "$$tmp"' EXIT && \
	cp -R $(MOODLE_PLUGIN_DIR) "$$tmp/$(MOODLE_PLUGIN_NAME)" && \
	(cd "$$tmp" && zip -rqX "$(CURDIR)/$(MOODLE_ZIP)" $(MOODLE_PLUGIN_NAME) -x '*.DS_Store')
	@echo "$(MOODLE_ZIP) を作成しました"

moodle-zip-clean: ## moodle/local_steplearn.zip を削除する
	rm -f $(MOODLE_ZIP)
