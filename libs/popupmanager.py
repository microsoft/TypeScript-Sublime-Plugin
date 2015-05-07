from string import Template

from . import logger
from .globalvars import *
from .workscheduler import work_scheduler
from .texthelpers import Location
from .editorclient import cli


class PopupManager():
    """ PopupManager manages the state and interaction with the popup window

    It uses the WorkScheduler class to handle sending requests to the server to
    ensure good performance.
    """

    html_template = ''

    def __init__(self, proxy):
        self.scheduler = work_scheduler()
        self.proxy = proxy

        # Maintains the latest set of signature data and rendering info
        self.current_view = None
        self.signature_help = None

        # Maintains the index of the current signature selected
        self.signature_index = 0
        self.current_parameter = 0

    def queue_signature_popup(self, view):
        cursor = view.rowcol(view.sel()[0].begin())
        point = Location(cursor[0] + 1, cursor[1] + 1)
        filename = view.file_name()

        # Define a function to do the request and notify on completion
        def get_signature_data(on_done):
            self.proxy.async_signature_help(filename, point, '', on_done)

        # Schedule the request
        self.scheduler.queue_request(get_signature_data,
                                     lambda resp: self.on_response(resp, view))

    def on_response(self, responseJson, view):
        # Needs to be set even if failed for on_close_popup to clear regions
        self.current_view = view
        if not responseJson["success"] or not responseJson["body"]:
            log.debug('No results for signature request')
            self.on_close_popup()
            return

        log.debug('Setting signature help data')
        self.current_view = view
        self.signature_help = responseJson["body"]
        self.signature_index = responseJson["body"]["selectedItemIndex"]
        self.current_parameter = responseJson["body"]["argumentIndex"]

        # Add a region to track the arg list as the user types
        # Needs to be ajusted to 0-based indexing
        arg_span = self.signature_help["applicableSpan"]
        span_start = view.text_point(
            arg_span["start"]["line"] - 1,
            arg_span["start"]["offset"] - 2)
        span_end = view.text_point(
            arg_span["end"]["line"] - 1,
            arg_span["end"]["offset"] - 1)
        arg_region = sublime.Region(span_start, span_end)
        view.add_regions('argSpan', [arg_region],
                         flags=sublime.HIDDEN)
        # To view region, set to: scope='comments', flags=sublime.DRAW_EMPTY)

        self.display()

    def display(self):
        popup_parts = self.get_current_signature_parts()
        popup_text = PopupManager.html_template.substitute(popup_parts)

        log.debug('Displaying signature popup')
        if not self.current_view.is_popup_visible():
            self.current_view.show_popup(
                popup_text,
                sublime.COOPERATE_WITH_AUTO_COMPLETE,
                on_navigate=self.on_navigate,
                on_hide=self.on_hidden,
                max_width=800)
        else:
            self.current_view.update_popup(popup_text)

    def move_next(self):
        if not self.signature_help:
            return
        self.signature_index += 1
        if self.signature_index >= len(self.signature_help["items"]):
            self.signature_index = len(self.signature_help["items"]) - 1
        self.display()

    def move_prev(self):
        if not self.signature_help:
            return
        self.signature_index -= 1
        if self.signature_index < 0:
            self.signature_index = 0
        self.display()

    def on_navigate(self, loc):
        # Clicked the overloads link.  Dismiss this popup and show the panel
        view = self.current_view
        self.on_close_popup()
        view.run_command('typescript_signature_panel')

    def on_hidden(self):
        log.debug('In popup on_hidden handler')
        if not self.current_view:
            return

        cursor_region = self.current_view.sel()[0]
        arg_regions = self.current_view.get_regions('argSpan')
        if len(arg_regions):
            argSpan = self.current_view.get_regions('argSpan')[0]
            if argSpan.contains(cursor_region):
                log.debug('Was hidden while in region.  Redisplaying')
                # Occurs on left/right movement.  Rerun to redisplay popup.
                self.display()
        else:
            # Cleanup
            self.on_close_popup()

    def on_close_popup(self):
        """ Call whenever the view loses focus, of the region is exited """
        if self.current_view:
            self.current_view.erase_regions('argSpan')
            self.current_view.hide_popup()
            self.current_view = None
        self.signature_help = None

    def is_active(self):
        """ Return True if a current popup session is running """
        return True if self.current_view else False

    def signature_to_html(self, item):
        result = ""

        def html_escape(str):
            return str.replace('&', '&amp;').replace(
                '<', '&lt;').replace('>', "&gt;")

        def normalize_style(name):
            if name in ['methodName']:
                return 'name'
            elif name in ['keyword', 'interfaceName']:
                return 'type'
            elif name in ['parameterName']:
                return 'param'
            return 'text'

        def concat_display_parts(parts, underline_name=False):
            result = ""
            template = '<span class="{0}">{1}</span>'
            for part in parts:
                css_class = normalize_style(part["kind"])
                result += template.format(css_class, html_escape(part["text"]))
                if underline_name and css_class == 'param':
                    result = '<span class="current">' + result + '</span>'
            return result

        # Add the prefix parts
        result += concat_display_parts(item["prefixDisplayParts"])

        # Add the params (if any)
        if item["parameters"]:
            idx = 0
            for param in item["parameters"]:
                if idx:
                    result += ", "
                result += concat_display_parts(param["displayParts"],
                                               idx == self.current_parameter)
                idx += 1

        # Add the suffix parts
        result += concat_display_parts(item["suffixDisplayParts"])

        return result

    def get_current_signature_parts(self):
        if self.signature_index == -1:
            return ""
        if self.signature_index >= len(self.signature_help["items"]):
            self.signature_index = len(self.signature_help["items"]) - 1

        item = self.signature_help["items"][self.signature_index]
        signature = self.signature_to_html(item)
        if item["documentation"]:
            description = item["documentation"][0]["text"]
        else:
            description = ""

        if self.current_parameter >= 0 and item["parameters"]:
            if self.current_parameter >= len(item["parameters"]):
                self.current_parameter = len(item["parameters"]) - 1
            param = item["parameters"][self.current_parameter]
            activeParam = '<span class="param">{0}:</span> <i>{1}</i>'.format(
                param["name"],
                param["documentation"][0]["text"] if param["documentation"] else "")
        else:
            activeParam = ''

        return {"signature": signature,
                "description": description,
                "activeParam": activeParam,
                "index": "{0}/{1}".format(self.signature_index + 1,
                                          len(self.signature_help["items"])),
                "link": "link"}

_popup_manager = None


def get_popup_manager():
    """Return the globally accessible popup_manager

    Note: it is wrapped in a function because no sublime APIs can be called
    during import time, namely no sublime API calls can be places at the
    module top level
    """
    global _popup_manager

    if TOOLTIP_SUPPORT:
        if _popup_manager is None:
            # Full path to template file
            html_path = os.path.join(PLUGIN_DIR, 'popup.html')

            # Needs to be in format such as: 'Packages/TypeScript/popup.html'
            rel_path = html_path[len(PACKAGES_DIR) - len('Packages'):]
            rel_path = rel_path.replace('\\', '/')  # Yes, even on Windows

            print(rel_path)

            logger.log.info('Popup resource path: {0}'.format(rel_path))
            popup_text = sublime.load_resource(rel_path)
            logger.log.info('Loaded tooltip template from {0}'.format(rel_path))

            PopupManager.html_template = Template(popup_text)
            _popup_manager = PopupManager(cli.service)
    else:
        _popup_manager = None

    return _popup_manager