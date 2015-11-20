import re

from string import Template

from .logger import log
from .global_vars import *
from .work_scheduler import work_scheduler
from .text_helpers import Location
from .editor_client import cli
from ..libs.view_helpers import reload_buffer

_POPUP_DEFAULT_FONT_SIZE = 12

class PopupManager():
    """ PopupManager manages the state and interaction with the popup window

    It uses the WorkScheduler class to handle sending requests to the server to
    ensure good performance.

    The main challenge is that certain activities, such as cursor movement, can
    automatically dismiss the popup - even though the cursor may still be in the
    argument list. Therefore the class listens to the on_hidden event, and will
    redisplay if necessary (i.e. if the cursor is still in the argument list).
    If the popup is explicitly dismissed, on_close_popup is called.
    """

    html_template = ''
    font_size = _POPUP_DEFAULT_FONT_SIZE

    def __init__(self, proxy):
        self.scheduler = work_scheduler()
        self.proxy = proxy

        # Maintains the latest set of signature data and rendering info
        self.current_view = None
        self.signature_help = None

        # Maintains the index of the current signature selected
        self.signature_index = 0
        self.current_parameter = 0

        # Track current popup location to see if we only need to update the text
        self.current_location = None

    def queue_signature_popup(self, view):
        cursor = view.rowcol(view.sel()[0].begin())
        point = Location(cursor[0] + 1, cursor[1] + 1)
        filename = view.file_name()

        # Define a function to do the request and notify on completion
        def get_signature_data(on_done):
            # Issue 233: In the middle of an argument list, the popup
            # disappears after user enters a line-break then immediately types
            # one (or more) character.
            # This is because we only send one reload request after the
            # line-break and never send reload request after the other
            # character.
            # We fix this issue by making sure a reload request is always sent
            # before every signature help request.

            # Check if user has just quickly typed a line-break followed
            # with one (or more) character. If yes, send a reload request.
            last_command, args, repeat_times = view.command_history(0)
            if last_command == "insert":
                if len(args['characters']) > 1 and '\n' in args['characters']:
                    reload_buffer(view)
            
            # Send a signagure_help request to server
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
        # Needs to be adjusted to 0-based indexing
        arg_span = self.signature_help["applicableSpan"]
        span_start = view.text_point(
            arg_span["start"]["line"] - 1,
            arg_span["start"]["offset"] - 2)
        span_end = view.text_point(
            arg_span["end"]["line"] - 1,
            arg_span["end"]["offset"])

        arg_region = sublime.Region(span_start, span_end)
        view.add_regions('argSpan', [arg_region],
                         flags=sublime.HIDDEN)
        # To view region, set to: scope='comments', flags=sublime.DRAW_EMPTY)

        self.display()

    def display(self):
        popup_parts = self.get_current_signature_parts()
        popup_text = PopupManager.html_template.substitute(popup_parts)

        log.debug('Displaying signature popup')

        arg_region = self.current_view.get_regions('argSpan')[0]
        location = arg_region.begin()  # Default to start of arg list

        # If the cursor is not in the first line of the arg list, set the popup
        # location to first non-whitespace, or EOL, of the current line
        cursor_point = self.current_view.sel()[0].begin()
        opening_line = self.current_view.line(arg_region.begin())
        if(not opening_line.contains(cursor_point)):
            cursor_line_start = self.current_view.line(cursor_point).begin()
            location = self.current_view.find(
                r'\s*?(?=[\S\n\r]|$)',
                cursor_line_start
            ).end()

        # If the popup is currently visible and at the right location, then
        # call 'update' instead of 'show', else this can get in a loop when show
        # causes the old popup to be hidden (and on_hidden is called), as well
        # as causing some unnecessary UI flickering.
        if self.current_view.is_popup_visible() and self.current_location == location:
            self.current_view.update_popup(popup_text)
        else:
            self.current_location = location
            self.current_view.show_popup(
                popup_text,
                sublime.COOPERATE_WITH_AUTO_COMPLETE,
                on_navigate=self.on_navigate,
                on_hide=self.on_hidden,
                location=location,
                max_width=800)

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
            log.debug('No current view for popup session. Hiding popup')
            return

        # If we're still in the arg list, then redisplay
        cursor_region = self.current_view.sel()[0]
        arg_regions = self.current_view.get_regions('argSpan')
        if len(arg_regions):
            argSpan = self.current_view.get_regions('argSpan')[0]
            if argSpan.contains(cursor_region):
                log.debug('Was hidden while in region.  Redisplaying')
                # Occurs on cursor movement.  Rerun to redisplay popup.
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
            elif name in ['parameterName', 'propertyName']:
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
        def encode(str, kind):
            return '<br />' if kind == "lineBreak" else str
    
        if self.signature_index == -1:
            return ""
        if self.signature_index >= len(self.signature_help["items"]):
            self.signature_index = len(self.signature_help["items"]) - 1

        item = self.signature_help["items"][self.signature_index]
        signature = self.signature_to_html(item)
        if item["documentation"]:
            description = ''.join([encode(doc["text"], doc["kind"]) for doc in item["documentation"]])
        else:
            description = ""

        if self.current_parameter >= 0 and item["parameters"]:
            if self.current_parameter >= len(item["parameters"]):
                self.current_parameter = len(item["parameters"]) - 1
            param = item["parameters"][self.current_parameter]
            activeParam = '<span class="param">{0}:</span> <i>{1}</i>'.format(
                param["name"],
                ''.join([encode(doc["text"], doc["kind"]) for doc in param["documentation"]]) 
                    if param["documentation"] else "")
        else:
            activeParam = ''

        return {"signature": signature,
                "description": description,
                "activeParam": activeParam,
                "index": "{0}/{1}".format(self.signature_index + 1,
                                          len(self.signature_help["items"])),
                "link": "link",
                "fontSize": PopupManager.font_size}

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
            rel_path = html_path[len(sublime.packages_path()) - len('Packages'):]
            rel_path = rel_path.replace('\\', '/')  # Yes, even on Windows

            print(rel_path)

            log.info('Popup resource path: {0}'.format(rel_path))
            popup_text = sublime.load_resource(rel_path)
            re_remove = re.compile("[\n\t\r]")
            popup_text = re_remove.sub("", popup_text)
            log.info('Loaded tooltip template from {0}'.format(rel_path))

            _set_up_popup_style()
            PopupManager.html_template = Template(popup_text)
            _popup_manager = PopupManager(cli.service)
    else:
        _popup_manager = None

    return _popup_manager

def _set_up_popup_style():
    settings = sublime.load_settings('Preferences.sublime-settings')
    settings.add_on_change('typescript_popup_font_size', _reload_popup_style)
    _reload_popup_style()

def _reload_popup_style():
    settings = sublime.load_settings('Preferences.sublime-settings')
    PopupManager.font_size = settings.get('typescript_popup_font_size', _POPUP_DEFAULT_FONT_SIZE)
