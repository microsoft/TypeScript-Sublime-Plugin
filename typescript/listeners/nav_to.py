from ..commands.nav_to import TypescriptNavToCommand
from ..libs.view_helpers import *
from ..libs import *
from .event_hub import EventHub


class NavToEventListener:
    """Event listeners for the TypescriptNavToCommand"""
    def on_activated_special_view(self, view):
        if TypescriptNavToCommand.nav_to_panel_started:
            # The current view is the QuickPanel. Set insert_text_finished to false to suppress
            # handling in on_modified
            TypescriptNavToCommand.insert_text_finished = False
            view.run_command("insert", {"characters": TypescriptNavToCommand.input_text})
            # Re-enable the handling in on_modified
            TypescriptNavToCommand.insert_text_finished = True

    def on_modified_special_view(self, view):
        logger.log.debug("enter on_modified: special view. started: %s, insert_text_finished: %s" %
                         (TypescriptNavToCommand.nav_to_panel_started, TypescriptNavToCommand.insert_text_finished))

        if TypescriptNavToCommand.nav_to_panel_started and TypescriptNavToCommand.insert_text_finished:
            new_content = view.substr(sublime.Region(0, view.size()))
            active_window().run_command("hide_overlay")
            sublime.set_timeout(
                lambda: active_window().run_command("typescript_nav_to", {'input_text': new_content}),
                0)

        logger.log.debug("exit on_modified: special view. started: %s, insert_text_finished: %s" %
                         (TypescriptNavToCommand.nav_to_panel_started, TypescriptNavToCommand.insert_text_finished))

listener = NavToEventListener()
EventHub.subscribe("on_activated_special_view", listener.on_activated_special_view)
EventHub.subscribe("on_modified_special_view", listener.on_modified_special_view)
