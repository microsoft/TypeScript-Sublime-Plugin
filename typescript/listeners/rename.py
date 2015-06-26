from ..libs import *
from .event_hub import EventHub


class RenameEventListener:
    def on_load(self, view):
        client_info = cli.get_or_add_file(view.file_name())
        # finish the renaming
        if client_info and client_info.rename_on_load:
            view.run_command(
                'typescript_delayed_rename_file',
                {"locs_name": client_info.rename_on_load}
            )
            client_info.rename_on_load = None

listener = RenameEventListener()
EventHub.subscribe("on_load", listener.on_load)