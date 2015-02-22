class Message(object):
    def __init__(self, seq, type, **kwargs):
        """
        A TypeScript Server message
        ``seq`` Sequence number of the message
        ``type`` One of "request", "response", or "event"
        """
        self.seq = seq
        self.type = type


class Request(Message):
    def __init__(self, command, seq, arguments=None):
        """ 
        Client-initiated request message
        ``command`` The command to execute
        ``arguments`` Object containing arguments for the command
        """
        super(Request, self).__init__(seq, "request")
        self.command = command
        self.arguments = arguments


class Event(Message):
    def __init__(self, event, **kwargs):
        """
        Server-initiated event message
        ``event`` Name of event
        """
        super(Event, self).__init__(**kwargs)
        self.event = event


class Response(Message):
    def __init__(self, request_seq, success, message=None, **kwargs):
        """
        Response by server to client request message
        ``request_seq`` Sequence number of the request message
        ``success`` Outcome of the request
        ``message`` Contains error message if success == false.
        """
        super(Response, self).__init__(**kwargs)
        self.request_seq = request_seq
        self.success = success
        self.message = message


class FileRequestArgs(object):
    def __init__(self, file):
        """
        Arguments for FileRequest messages
        ``file`` The file for the request (absolute pathname required)
        """
        self.file = file


class FileRequest(Request):
    def __init__(self, command, seq, fileRequestArgs):
        """
        Request whose sole parameter is a file name
        """
        super(FileRequest, self).__init__(command, seq, fileRequestArgs)


class FileLocationRequestArgs(FileRequestArgs):
    def __init__(self, file, line, col):
        """
        Instances of this interface specify a file location:
        (file, line, col), where line and column are 1-based.
        ``line`` The line number for the request (1-based)
        ``column`` The column for the request (1-based)
        """
        super(FileLocationRequestArgs, self).__init__(file)
        self.line = line
        self.col = col


class FileLocationRequest(Request):
    def __init__(self, command, seq, fileLocationRequestArgs):
        """
        A request whose arguments specify a file location (file, line, col)
        """
        super(FileLocationRequest, self).__init__(command, seq, fileLocationRequestArgs)


class DefinitionRequest(FileLocationRequest):
    def __init__(self, seq, fileLocationRequestArgs):
        """
        Go to definition request; value of command field is
        "definition". Return response giving the file locations that
        define the symbol found in file at location line, col.
        """
        super(DefinitionRequest, self).__init__("definition", seq, fileLocationRequestArgs)


class Location:
    def __init__(self, line, col):
        """
        Object containing line and column (one-based) of file location
        """
        self.line = line
        self.col = col

    def toDict(self):
        return { "line": self.line, "col": self.col }

class FileSpan(object):
    def __init__(self, file, start, end):
        self.file = file
        self.start = Location(**start)
        self.end = Location(**end)

class FileSpanWithinFile:
    def __init__(self, start, end):
        self.start = Location(**start)
        self.end = Location(**end)

    def toDict(self):
        return {
            "start": self.start.toDict(),
            "end": self.end.toDict()
        }

class DefinitionResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        Definition response message.  Gives text range for definition.
        """
        super(DefinitionResponse, self).__init__(**kwargs)
        self.body = [FileSpan(**cs) for cs in body] if body else None


class ReferencesRequest(FileLocationRequest):
    def __init__(self, seq, fileLocationRequestArgs):
        """
        Find references request; value of command field is
        "references". Return response giving the file locations that
        reference the symbol found in file at location line, col.
        """
        super(ReferencesRequest, self).__init__("references", seq, fileLocationRequestArgs)


class ReferencesResponseItem(FileSpan):
    def __init__(self, lineText, isWriteAccess, **kwargs):
        """
        Text of line containing the reference
        """
        super(ReferencesResponseItem, self).__init__(**kwargs)
        self.lineText = lineText
        self.isWriteAccess = isWriteAccess


class ReferencesResponseBody:
    def __init__(self, refs, symbolName, symbolStartCol, symbolDisplayString, **kwargs):
        self.refs = [ReferencesResponseItem(**ri) for ri in refs]
        self.symbolName = symbolName
        self.symbolStartCol = symbolStartCol
        self.symbolDisplayString = symbolDisplayString


class ReferencesResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        References response message.  ``body`` is of type ReferencesResponseBody
        """
        super(ReferencesResponse, self).__init__(**kwargs)
        self.body = ReferencesResponseBody(**body) if body else None


class RenameRequest(FileLocationRequest):
    def __init__(self, seq, fileLocationRequestArgs):
        """
        Rename request; value of command field is "rename". Return
        response giving the file locations that reference the symbol
        found in file at location line, col. Also return full display
        name of the symbol so that client can print it unambiguously.
        """
        super(RenameRequest, self).__init__("rename", seq, fileLocationRequestArgs)


class RenameInfo:
    def __init__(self, canRename, displayName, fullDisplayName, kind, kindModifiers, localizedErrorMessage = None, **kwargs):
        """
        Information about the item to be renamed.
        ``fullDisplayName`` Full display name of item to be renamed
        """
        self.fullDisplayName = fullDisplayName


class FileLocations:
    def __init__(self, file, locs):
        self.file = file
        self.locs = [FileSpanWithinFile(**cs) for cs in locs]


class RenameResponseBody:
    def __init__(self, info, locs):
        """
        ``info`` Information about the item to be renamed
        ``locs`` An array of file locations that refer to the item to be renamed.
        """
        self.info = RenameInfo(**info)
        self.locs = [FileLocations(**fl) for fl in locs]


class RenameResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        Rename response message.
        """
        super(RenameResponse, self).__init__(**kwargs)
        self.body = RenameResponseBody(**body) if body else None


class TypeRequest(FileLocationRequest):
    def __init__(self, seq, fileLocationRequestArgs):
        """
        Type request; value of command field is "type". Return response
        giving the file locations that define the type of the symbol
        found in file at location line, col.
        """
        super(TypeRequest, self).__init__("type", seq, fileLocationRequestArgs)


class TypeResponse(Response): 
    def __init__(self, body=None, **kwargs):
        super(TypeResponse, self).__init__(**kwargs)
        self.body = [FileSpan(**cs) for cs in body] if body else None


class OpenRequest(FileRequest):
    def __init__(self, seq, fileRequestArgs):
        """
        Open request; value of command field is "open". Notify the
        server that the client has file open.  The server will not
        monitor the filesystem for changes in this file and will assume
        that the client is updating the server (using the change and/or
        reload messages) when the file changes.
        ``fileRequestArgs`` is of type FileRequestArgs
        """
        super(OpenRequest, self).__init__("open", seq, fileRequestArgs)


class CloseRequest(FileRequest):
    def __init__(self, seq, fileRequestArgs):
        """
        Close request; value of command field is "close". Notify the
        server that the client has closed a previously open file.  If
        file is still referenced by open files, the server will resume
        monitoring the filesystem for changes to file.
        ``fileRequestArgs`` is of type FileRequestArgs
        """
        super(CloseRequest, self).__init__("close", seq, fileRequestArgs)


class QuickInfoRequest(FileLocationRequest):
    def __init__(self, seq, fileLocationRequestArgs):
        """
        Quickinfo request; value of command field is
        "quickinfo". Return response giving a quick type and
        documentation string for the symbol found in file at location
        line, col.
        """
        super(QuickInfoRequest, self).__init__("quickinfo", seq, fileLocationRequestArgs)


class QuickInfoResponseBody:
    def __init__(self, kind,start, end, displayString, documentation, kindModifiers=None, **kwargs):
        """
        Quick info response body details
        ``info`` Type and kind of symbol
        ``doc`` Documentation associated with symbol
        """
        self.kind = kind
        self.kindModifiers = kindModifiers
        self.start = start
        self.end = end
        self.displayString = displayString
        self.documentation = documentation


class QuickInfoResponse(Response):
    def __init__(self, body=None, **kwargs):
        """ 
        Quickinfo response message
        """
        super(QuickInfoResponse, self).__init__(**kwargs)
        self.body = QuickInfoResponseBody(**body) if body else None


class FormatRequestArgs(FileLocationRequestArgs):
    def __init__(self, file, line, col, endLine, endCol):
        """
        Arguments for format messages
        ``endLine`` Last line of range for which to format text in file
        ``endCol`` Last column of range for which to format text in file
        """
        super(FormatRequestArgs, self).__init__(file, line, col)
        self.endLine = endLine
        self.endCol = endCol


class FormatRequest(FileLocationRequest):
    def __init__(self, seq, formatRequestArgs):
        """
        Format request; value of command field is "format".  Return
        response giving zero or more edit instructions.  The edit
        instructions will be sorted in file order.  Applying the edit
        instructions in reverse to file will result in correctly
        reformatted text.
        """
        super(FormatRequest, self).__init__("format", seq, formatRequestArgs)


class FormatOnKeyRequestArgs(FileLocationRequestArgs):
    def __init__(self, file, line, col, key):
        """
        Arguments for format on key messages
        ``key`` Key pressed (';', '\\n', or '}')
        """
        super(FormatOnKeyRequestArgs, self).__init__(file, line, col)
        self.key = key


class FormatOnKeyRequest(FileLocationRequest):
    def __init__(self, seq, formatOnKeyRequestArgs):
        """
        Format on key request; value of command field is
        "formatonkey". Given file location and key typed (as string),
        return response giving zero or more edit instructions.  The
        edit instructions will be sorted in file order.  Applying the
        edit instructions in reverse to file will result in correctly
        reformatted text.
        """
        super(FormatOnKeyRequest, self).__init__("formatonkey", seq, formatOnKeyRequestArgs)


class CodeEdit:
    def __init__(self, start, end, newText):
        """
        Object found in response messages defining an editing
        instruction for a span of text in source code.  The effect of
        this instruction is to replace the text starting at start and
        ending one character before end with newText. For an insertion,
        the text span is empty.  For a deletion, newText is empty.
        ``start`` First character of the text span to edit.
        ``end`` One character past last character of the text span to edit
        ``newText`` Replace the span defined above with this string (may be the empty string)
        """
        self.start = Location(**start)
        self.end = Location(**end)
        self.newText = newText


class FormatResponse(Response):
    def __init__(self, body=None, **kwargs):
        """
        Format and format on key response message
        """
        super(FormatResponse, self).__init__(**kwargs)
        self.body = [CodeEdit(**ce) for ce in body] if body else None


class CompletionsResponse(Response):
    def __init__(self, body=None, **kwargs):
        super(CompletionsResponse, self).__init__(**kwargs)
        self.body = [CompletionItem(**ci) for ci in body] if body else None


class CompletionsRequestArgs(FileLocationRequestArgs):
    def __init__(self, file, line, col, prefix=""):
        """
        Arguments for completions messages
        ``prefix`` Optional prefix to apply to possible completions.
        """
        super(CompletionsRequestArgs, self).__init__(file, line, col)
        self.prefix = prefix


class CompletionsRequest(FileLocationRequest):
    def __init__(self, seq, completionsRequestArgs):
        """
        Completions request; value of command field is "completions".
        Given a file location (file, line, col) and a prefix (which may
        be the empty string), return the possible completions that
        begin with prefix.
        """
        super(CompletionsRequest, self).__init__("completions", seq, completionsRequestArgs)


class SymbolDisplayPart:
    def __init__(self, text, kind):
        """
        Part of a symbol description.
        ``text`` Text of an item describing the symbol
        ``kind`` The symbol's kind (such as 'className' or 'parameterName' or plain 'text')
        """
        self.text = text
        self.kind = kind


class CompletionItem:
    def __init__(self, name, kind, kindModifiers=None, displayParts=None, documentation=None, **kwargs):
        """
        An item found in a completion response
        ``name`` The symbol's name
        ``kind`` The symbol's kind (such as 'className' or 'parameterName')
        ``kindModifiers`` Optional modifiers for the kind (such as 'public')
        ``documentation`` Documentation strings for the symbol
        """
        self.name = name
        self.kind = kind
        self.kindModifiers = kindModifiers
        self.displayParts = [SymbolDisplayPart(**dp) for dp in displayParts] if displayParts else None
        self.documentation = [SymbolDisplayPart(**dp) for dp in documentation] if documentation else None


class CompletionsResponse(Response):
    def __init__(self, body=None, **kwargs):
        super(CompletionsResponse, self).__init__(**kwargs)
        self.body = [CompletionItem(**ci) for ci in body] if body else None


class GeterrRequestArgs:
    def __init__(self, files, delay):
        """ 
        Arguments for geterr messages.
        ``files`` Array of file names for which to compute compiler errors.
        ``delay`` Delay in milliseconds to wait before starting to compute errors for the files in the file list
        """
        self.files = files
        self.delay = delay


class GeterrRequest(Request):
    def __init__(self, seq, geterrRequestArgs):
        """
        Geterr request; value of command field is "geterr". Wait for
        delay milliseconds and then, if during the wait no change or
        reload messages have arrived for the first file in the files
        list, get the syntactic errors for the file, field requests,
        and then get the semantic errors for the file.  Repeat with a
        smaller delay for each subsequent file on the files list.  Best
        practice for an editor is to send a file list containing each
        file that is currently visible, in most-recently-used order.
        """
        super(GeterrRequest, self).__init__("geterr", seq, geterrRequestArgs)


class Diagnostic:
    def __init__(self, start, end, text):
        """
        Item of diagnostic information found in a DiagnosticEvent message
        ``start`` Starting code location at which text appies
        ``end`` One past last code location at which text applies
        ``text`` Text of diagnostic message
        """
        self.start = Location(**start)
        self.end = Location(**end)
        self.text = text


class DiagnosticEventBody:
    def __init__(self, file, diagnostics):
        """
        ``file`` The file for which diagnostic information is reported
        ``diagnostics`` An array of diagnostic information items
        """
        self.file = file
        self.diagnostics = [Diagnostic(**d) for d in diagnostics] if diagnostics else None


class DiagnosticEvent(Event):
    def __init__(self, body=None, **kwargs):
        """
        Event message for "syntaxDiag" and "semanticDiag" event types.
        These events provide syntactic and semantic errors for a file.
        """
        super(DiagnosticEvent, self).__init__(**kwargs)
        self.body = DiagnosticEventBody(**body) if body else None


class ReloadRequestArgs(FileRequestArgs):
    def __init__(self, file, tmpfile):
        """
        Arguments for reload request.
        ``tmpfile`` Name of temporary file from which to reload file contents. May be same as file.
        """
        super(ReloadRequestArgs, self).__init__(file)
        self.tmpfile = tmpfile


class ReloadRequest(Request):
    def __init__(self, seq, reloadRequestArgs):
        """
        Reload request message; value of command field is "reload".
        Reload contents of file with name given by the 'file' argument
        from temporary file with name given by the 'tmpfile' argument.
        The two names can be identical.
        """
        super(ReloadRequest, self).__init__("reload", seq, reloadRequestArgs)


class ReloadResponse(Response):
    def __init__(self, **kwargs):
        super(ReloadResponse, self).__init__(**kwargs)


class ChangeRequestArgs(FormatRequestArgs):
    def __init__(self, file, line, col, endLine, endCol, insertString=""):
        """
        Arguments for change request message.
        ``insertString`` Optional string to insert at location (file, line col).
        """
        super(ChangeRequestArgs, self).__init__(file, line, col, endLine, endCol)
        self.insertString = insertString


class ChangeRequest(FileLocationRequest):
    def __init__(self, seq, changeRequestArgs):
        """
        Change request message; value of command field is "change".
        Update the server's view of the file named by argument 'file'.  
        """
        super(ChangeRequest, self).__init__("change", seq, changeRequestArgs)

class SavetoRequest(Request):
    def __init__(self, seq, reloadRequestArgs):
        """
        Reload request message; value of command field is "reload".
        Reload contents of file with name given by the 'file' argument
        from temporary file with name given by the 'tmpfile' argument.
        The two names can be identical.
        """
        super(SavetoRequest, self).__init__("saveto", seq, reloadRequestArgs)
