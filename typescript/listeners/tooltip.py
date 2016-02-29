from ..libs.global_vars import *
from ..libs.view_helpers import active_window
from ..libs import *
from .event_hub import EventHub


class TooltipEventListener:

    def __init__(self):
        self.was_paren_pressed = False

    def on_selection_modified(self, view):
        if TOOLTIP_SUPPORT:
            popup_manager = get_popup_manager()
            # Always reset this flag
            _paren_pressed = self.was_paren_pressed
            self.was_paren_pressed = False

            if popup_manager.is_active():
                popup_manager.queue_signature_popup(view)
            else:
                if _paren_pressed:
                    # TODO: Check 'typescript_auto_popup' setting is True
                    logger.log.debug('Triggering popup of sig help on paren')
                    popup_manager.queue_signature_popup(view)

    def on_selection_modified_with_info(self, view, info):
        # hide the doc info output panel if it's up
        panel_view = active_window().get_output_panel("doc")
        if panel_view.window():
            active_window().run_command("hide_panel", {"cancel": True})

    def on_text_command(self, view, command_name, args):
        if command_name == 'hide_popup':
            popup_manager = get_popup_manager()
            popup_manager.on_close_popup()

    def on_query_context(self, view, key, operator, operand, match_all):
        if key == 'is_popup_visible' and TOOLTIP_SUPPORT:
            return view.is_popup_visible()
        if key == 'paren_pressed':
            # Dummy check we never intercept, used as a notification paren was
            # pressed.  Used to automatically display signature help.
            self.was_paren_pressed = True
            return False
        if key == 'tooltip_supported':
            return TOOLTIP_SUPPORT == operand
        return None


listen = TooltipEventListener()
EventHub.subscribe("on_selection_modified", listen.on_selection_modified)
EventHub.subscribe("on_selection_modified_with_info", listen.on_selection_modified_with_info)
EventHub.subscribe("on_text_command", listen.on_text_command)
EventHub.subscribe("on_query_context", listen.on_query_context)
