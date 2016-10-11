from .event_hub import EventHub
from ..libs.view_helpers import *
from ..libs.logger import log
from ..libs import cli

class QuickInfoToolTipEventListener:
    def on_hover(self, view, point, hover_zone):
        view.run_command('typescript_quick_info_doc', {"hover_point": point})

listen = QuickInfoToolTipEventListener()
EventHub.subscribe("on_hover", listen.on_hover)
