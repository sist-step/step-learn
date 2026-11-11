MOODLE_PLUGINS := local_steplearn mod_stepbundle
MOODLE_ZIPS := $(MOODLE_PLUGINS:%=moodle/%.zip)

.PHONY: help moodle-zip moodle-zip-clean
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

help: ## コマンドの一覧を表示する
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

# ファイルの更新日時で差分ビルドにしないのは、削除したファイルが zip に残ってしまうため。
# zip の中のディレクトリ名は、プラグインの種類（local_・mod_）を除いた名前にする
moodle-zip: ## Moodle プラグインを moodle/<プラグイン>.zip にまとめる
	rm -f $(MOODLE_ZIPS)
	tmp=$$(mktemp -d) && trap 'rm -rf "$$tmp"' EXIT && \
	for plugin in $(MOODLE_PLUGINS); do \
		name=$${plugin#*_} && \
		cp -R moodle/$$plugin "$$tmp/$$name" && \
		(cd "$$tmp" && zip -rqX "$(CURDIR)/moodle/$$plugin.zip" $$name -x '*.DS_Store') && \
		echo "moodle/$$plugin.zip を作成しました" || exit 1; \
	done

moodle-zip-clean: ## moodle/<プラグイン>.zip を削除する
	rm -f $(MOODLE_ZIPS)
