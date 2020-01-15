import sublime_plugin

from ..libs import *
from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand

class RefactorAction:
    def __init__(self, refactor_name, action_name, description):
        self.refactor_name = refactor_name
        self.action_name = action_name
        self.description = description

class TypescriptGetApplicableRefactorsCommand(TypeScriptBaseTextCommand):
    """Get refactors applicable to a specific region"""
    def run(self, text):
        check_update_view(self.view)
        file_name = self.view.file_name()
        (start_loc, end_loc) = get_start_and_end_from_view(self.view)

        def choose(actions, index):
            self.choose_refactor(file_name, start_loc, end_loc, actions, index)

        def receive(response):
            self.receive_refactors(response, choose)

        cli.service.get_applicable_refactors_async(file_name, start_loc, end_loc, receive)

    def receive_refactors(self, refactors_resp, choose):
        if not refactors_resp["success"]:
            return

        actions = []
        for refactor in refactors_resp["body"]:
            refactor_name = refactor["name"]
            if "inlineable" in refactor and not refactor["inlineable"]:
                actions.append(RefactorAction(refactor_name, refactor_name, refactor["description"]))
            else:
                actions.extend(map(lambda action: RefactorAction(refactor_name, action["name"], action["description"]), refactor["actions"]))

        refactoring_names = list(map(lambda action: action.description, actions))

        # Somehow there's a blocking bug with `show_popup_menu`
        # that leads to issues on certain platforms.
        # https://github.com/SublimeTextIssues/Core/issues/1282
        #   self.view.show_popup_menu(refactoring_names, delayed_choose)
        # So instead we can use `show_quick_panel` which looks great anyway.
        active_window().show_quick_panel(refactoring_names, lambda i: choose(actions, i))

    def choose_refactor(self, file_name, start_loc, end_loc, actions, index):
        if index < 0:
            return
        action = actions[index]

        def on_completed(edits_response):
            self.view.run_command("typescript_apply_refactor", { "edits_response": edits_response })

        def request_edits():
            cli.service.get_edits_for_refactor_async(
                path = file_name,
                refactor_name = action.refactor_name,
                action_name = action.action_name,
                start_loc = start_loc, end_loc = end_loc,
                on_completed = on_completed)
        request_edits()

class TypescriptApplyRefactorCommand(TypeScriptBaseTextCommand):
    def run(self, text, edits_response):
        if not edits_response["success"]:
            return

        for edit in edits_response["body"]["edits"]:
            file_name = edit["fileName"]
            file_view = active_window().find_open_file(file_name)
            if not file_view:
                client_info = cli.get_or_add_file(file_name)
                client_info.refactors_on_load = { "textChanges": edit["textChanges"] }
                active_window().open_file(file_name)
            else:
                apply_formatting_changes(text, self.view, edit["textChanges"])
