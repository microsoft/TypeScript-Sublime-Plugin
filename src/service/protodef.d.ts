/** Declaration module describing the TypeScript Server protocol */
declare module ServerProtocol {
    /** A TypeScript Server message */
    export interface Message {
        /** Sequence number of the message */
        seq: number;
        /** One of "request", "response", or "event" */
        type: string;
    }
    
    /** Client-initiated request message */
    export interface Request extends Message {
        /** The command to execute */
        command: string;
        /** Object containing arguments for the command */
        arguments?: any;
    }

    /** Server-initiated event message */
    export interface Event extends Message {
        /** Name of event */
        event: string;
        /** Event-specific information */
        body?: any;
    }

    /** Response by server to client request message */
    export interface Response extends Message {
        /** Sequence number of the request message */
        request_seq: number;
        /** Outcome of the request */
        success: boolean;
        /** Contains error message if success == false. */
        message?: string;
        /** Contains message body if success == true. */
        body?: any;
    }

    /** Arguments for BasicRequest messages */
    export interface BasicRequestArgs extends Request {
        /** The line number for the request (1-based) */
        line?: number;
        /** The column for the request (1-based) */
        col?: number;
        /** The file for the request (absolute pathname required) */
        file: string;
    }

    /**
       Request whose arguments are line, col, file, giving a location
       (line,col) in buffer named file.
    */
    export interface BasicRequest extends Request {
        arguments: BasicRequestArgs;
    }

    /**
       Go to definition request; value of command field is
       "definition". Return response giving the code locations that
       define the symbol found in file at location line, col.
    */
    export interface DefinitionRequest extends BasicRequest {
    }

    /**
       Object containing line and column (one-based) of code location
    */
    export interface LineCol {
        line: number;
        col: number;
    }

    /**
       Body portion of definition response message.
    */
    // TODO: make this an array
    export interface DefinitionResponseBody {
        /** File containing the definition */
        file: string;
        /** First character of the definition */
        min: LineCol;
        /** One character past last character of the definition */
        lim: LineCol;
    }

    /**
       Definition response message.  Gives text range for definition.
     */
    // TODO: make this contain multiple definition locations
    export interface DefinitionResponse extends Response {
        body?: DefinitionResponseBody;
    }

    /**
       Find references request; value of command field is
       "references". Return response giving the code locations that
       reference the symbol found in file at location line, col.
    */
    export interface ReferencesRequest extends BasicRequest {
    }

    export interface FindReferencesResponseItem {
        /** File containing the reference */
        file: string;
        /** First character of the reference */
        min: LineCol;
        /** One character past last character of the reference */
        lim: LineCol;
        /** Text of line containing the reference */
        lineText: string;
    }

    export interface FindReferencesResponseBody {
        refs: FindReferencesResponseItem[];
        symbolName: string;
        symbolStartCol: number;
        symbolDisplayString: string;
    }

    /**
       Rename request; value of command field is "rename". Return
       response giving the code locations that reference the symbol
       found in file at location line, col. Also give fully-qualfied
       name of the symbol so that client can print it unambiguously.
    */
    export interface RenameRequest extends BasicRequest {
    }

    /**
       Type request; value of command field is "type". Return response
       giving the code locations that define the type of the symbol
       found in file at location line, col.
    */
    export interface TypeRequest extends BasicRequest {
    }

    /**
       Open request; value of command field is "open". Notify the
       server that the client has file open.  The server will not
       monitor the filesystem for changes in this file and will assume
       that the client is updating the server (using the change and/or
       reload messages) when the file changes.
    */
    export interface OpenRequest extends BasicRequest {
    }

    /**
       Close request; value of command field is "close". Notify the
       server that the client has closed a previously open file.  If
       file is still referenced by open files, the server will resume
       monitoring the filesystem for changes to file.
    */
    export interface CloseRequest extends BasicRequest {
    }

    /**
       Quickinfo request; value of command field is
       "quickinfo". Return response giving a quick type and
       documentation string for the symbol found in file at location
       line, col.
    */
    export interface QuickInfoRequest extends BasicRequest {
    }

    /** Arguments for format messages */
    export interface FormatRequestArgs extends BasicRequestArgs {
        /** Last line of range for which to format text in file */
        endLine: number;
        /** Last column of range for which to format text in file */
        endCol: number;
    }

    /**
       Format request; value of command field is "format".  Return
       response giving zero or more edit instructions.  The edit
       instructions will be sorted in file order.  Applying the edit
       instructions in reverse to file will result in correctly
       reformatted text.
    */
    export interface FormatRequest extends BasicRequest {
        arguments: FormatRequestArgs;
    } 

    /** Arguments for format on key messages */
    export interface FormatOnKeyRequestArgs extends BasicRequestArgs {
        /** Key pressed (';', '\n', or '}') */
        key: string;
    }

    /**
       Format on key request; value of command field is
       "formatonkey". Given file location and key typed (as string),
       return response giving zero or more edit instructions.  The
       edit instructions will be sorted in file order.  Applying the
       edit instructions in reverse to file will result in correctly
       reformatted text.
    */
    export interface FormatOnKeyRequest extends BasicRequest {
        arguments: FormatOnKeyRequestArgs;
    }

    /** Arguments for completions messages */
    export interface CompletionsRequestArgs extends BasicRequestArgs {
        /** Optional prefix to apply to possible completions. */
        prefix?: string;
    }

    /**
       Completions request; value of command field is "completions".
       Given a file location (file, line, col) and a prefix (which may
       be the empty string), return the possible completions that
       begin with prefix.
    */
    export interface CompletionsRequest extends BasicRequest {
        arguments: CompletionsRequestArgs;
    }

    /** Arguments for geterr messages.  */
    export interface GeterrRequestArgs extends BasicRequestArgs {
        /**
           Semi-colon separated list of file names for which to compute
           compiler errors.
        */
        files: string;
        /**
           Delay in milliseconds to wait before starting to compute
           errors for the files in the file list
        */
        delay: number;
    }

    /**
       Geterr request; value of command field is "geterr". Wait for
       delay milliseconds and then, if during the wait no change or
       reload messages have arrived for the first file in the files
       list, get the syntactic errors for the file, field requests,
       and then get the semantic errors for the file.  Repeat with a
       smaller delay for each subsequent file on the files list.  Best
       practice for an editor is to send a file list containing each
       file that is currently visible, in most-recently-used order.
    */
    export interface GeterrRequest extends BasicRequest {
        arguments: GeterrRequestArgs;
    }


    /** Arguments for reload request. */
    export interface ReloadRequestArgs extends BasicRequestArgs {
        /**
           Name of temporary file from which to reload file
           contents. May be same as file.
        */
        tmpfile: string;
    }

    /**
       Reload request message; value of command field is "reload".
       Reload contents of file with name given by the 'file' argument
       from temporary file with name given by the 'tmpfile' argument.
       The two names can be identical.
    */ 
    export interface ReloadRequest extends BasicRequest {
        arguments: ReloadRequestArgs;
    }


    /** Arguments for saveto request. */
    export interface SavetoRequestArgs extends BasicRequestArgs {
        /**
           Name of temporary file into which to save server's view of
           file contents.
        */
        tmpfile: string;
    }

    /**
       Saveto request message; value of command field is "saveto".
       For debugging purposes, save to a temporaryfile (named by
       argument 'tmpfile') the contents of file named by argument
       'file'.  
    */
    export interface SavetoRequest extends BasicRequest {
        arguments: SavetoRequestArgs;
    }

    /** Arguments for navto request message */
    export interface NavtoRequestArgs extends BasicRequestArgs {
        /**
           Search term to navigate to from current location; term can
           be '.*' or an identifier prefix.
        */
        searchTerm: string;
    }

    /**
       Navto request message; value of command field is "navto".
       Return list of objects giving code locations and symbols that
       match the search term given in argument 'searchTerm'.  
    */
    export interface NavtoRequest extends BasicRequest {
        arguments: NavtoRequestArgs;
    }

    /** Arguments for change request message. */
    export interface ChangeRequestArgs extends BasicRequestArgs {
        /**
           Length of span deleted at location (file, line, col); may
           be zero.
        */
        deleteLen: number;
        /**
           Length of string to insert at location (file, line, col); may
           be zero.
        */
        insertLen: number;
        /** Optional string to insert at location (file, line col). */
        insertString?: string;
    }

    /**
       Change request message; value of command field is "change".
       Update the server's view of the file named by argument 'file'.  
    */
    export interface ChangeRequest extends BasicRequest {
        arguments: ChangeRequestArgs;
    }
}






