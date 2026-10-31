import {chatType, defaultChatTypes, type Chat, type ChatType} from './telegram.js';
import {messageItems, messageRows, type Message, type MessageView} from './messages.js';
import type {History} from './operations.js';

export type ViewState = {
  chats: Chat[];
  query: string;
  types: ReadonlySet<ChatType>;
  postsView: MessageView;
  chatView: MessageView;
  ownOnly: boolean;
  ownChatIds: ReadonlySet<string>;
  activeId?: string;
  view: MessageView;
  history: History;
  messageIndex: number;
  selected: Set<number>;
  messageStatus: 'loading' | 'ready' | 'error';
};
export const initialView: ViewState = {
  chats: [],
  query: '',
  types: defaultChatTypes,
  postsView: 'all',
  chatView: 'mine',
  ownOnly: false,
  ownChatIds: new Set(),
  view: 'mine',
  history: {items: [], cursor: 0, more: false},
  messageIndex: 0,
  selected: new Set(),
  messageStatus: 'ready',
};
export function visibleChats(state: ViewState): Chat[] {
  return state.chats.filter(
    (chat) =>
      state.types.has(chatType(chat)) &&
      (!state.ownOnly || state.ownChatIds.has(chat.id)) &&
      `${chat.title} ${chat.id} ${chat.discussionFor ?? ''}`
        .toLocaleLowerCase()
        .includes(state.query.toLocaleLowerCase()),
  );
}
function clearMessages(state: ViewState): ViewState {
  const broadcast = state.chats.find((chat) => chat.id === state.activeId)?.isBroadcast;
  return {
    ...state,
    view: broadcast ? state.postsView : state.chatView,
    history: {items: [], cursor: 0, more: false},
    selected: new Set(),
    messageIndex: 0,
    messageStatus: state.activeId ? 'loading' : 'ready',
  };
}
export type ViewAction =
  | {type: 'chats'; chats: Chat[]; ownChatIds?: ReadonlySet<string>; ownOnly?: boolean}
  | {type: 'ownFilter'; enabled: boolean; ids?: ReadonlySet<string>}
  | {type: 'query'; query: string}
  | {type: 'private'}
  | {type: 'types'; types: ReadonlySet<ChatType>}
  | {type: 'view'}
  | {type: 'reload'}
  | {type: 'revalidate'}
  | {type: 'locatedPost'; chatId: string; view: MessageView; postId: number; history: History}
  | {type: 'active'; id: string | undefined}
  | {
      type: 'history';
      chatId: string;
      view: MessageView;
      history: History;
      selected?: Set<number>;
      hasOwn?: boolean;
    }
  | {type: 'failed'; chatId: string; view: MessageView}
  | {type: 'index'; index: number}
  | {type: 'selection'; ids: Set<number>}
  | {type: 'absent'; chatId: string; ids: ReadonlySet<number>};
export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'chats':
    case 'ownFilter': {
      const next =
        action.type === 'chats'
          ? {
              ...state,
              chats: action.chats,
              ownChatIds: action.ownChatIds ?? state.ownChatIds,
              ownOnly: action.ownOnly ?? state.ownOnly,
            }
          : {...state, ownOnly: action.enabled, ownChatIds: action.ids ?? state.ownChatIds};
      const chats = visibleChats(next);
      const activeId = chats.some((chat) => chat.id === state.activeId) ? state.activeId : chats[0]?.id;
      return activeId === state.activeId ? next : clearMessages({...next, activeId});
    }
    case 'query':
    case 'private':
    case 'types': {
      const next =
        action.type === 'query'
          ? {...state, query: action.query}
          : {
              ...state,
              types:
                action.type === 'types'
                  ? action.types
                  : new Set<ChatType>([
                      ...[...state.types].filter((type) => type !== 'private' && type !== 'bot'),
                      ...(state.types.has('private') || state.types.has('bot')
                        ? []
                        : (['private', 'bot'] as const)),
                    ]),
            };
      const chats = visibleChats(next);
      const activeId = chats.some((chat) => chat.id === state.activeId) ? state.activeId : chats[0]?.id;
      return activeId === state.activeId ? next : clearMessages({...next, activeId});
    }
    case 'active':
      return action.id === state.activeId ? state : clearMessages({...state, activeId: action.id});
    case 'view': {
      const view = state.view === 'mine' ? 'all' : 'mine';
      const broadcast = state.chats.find((chat) => chat.id === state.activeId)?.isBroadcast;
      return clearMessages({...state, ...(broadcast ? {postsView: view} : {chatView: view})});
    }
    case 'reload':
      return clearMessages(state);
    case 'revalidate':
      return {...state, messageStatus: state.activeId ? 'loading' : 'ready'};
    case 'locatedPost': {
      if (
        action.chatId !== state.activeId ||
        action.view !== state.view ||
        !state.chats.find((chat) => chat.id === action.chatId)?.isBroadcast
      )
        return state;
      const index = messageRows(action.history.items).findIndex((message) =>
        messageItems(message).some((item) => item.id === action.postId),
      );
      if (index === -1) return state;
      const own = new Set(action.history.items.filter((message) => message.own).map((message) => message.id));
      return {
        ...state,
        history: action.history,
        view: 'all',
        postsView: 'all',
        messageStatus: 'ready',
        messageIndex: index,
        selected:
          state.view === 'mine' ? new Set() : new Set([...state.selected].filter((id) => own.has(id))),
      };
    }
    case 'failed':
      return action.chatId === state.activeId && action.view === state.view
        ? {...state, messageStatus: 'error'}
        : state;
    case 'history': {
      if (action.chatId !== state.activeId || action.view !== state.view) return state;
      if (state.ownOnly && action.hasOwn === false) {
        const ownChatIds = new Set(state.ownChatIds);
        ownChatIds.delete(action.chatId);
        const next = {...state, ownChatIds};
        return clearMessages({...next, activeId: visibleChats(next)[0]?.id});
      }
      return {
        ...state,
        history: action.history,
        messageStatus: 'ready',
        messageIndex: Math.max(0, Math.min(state.messageIndex, messageRows(action.history.items).length - 1)),
        ...(action.selected ? {selected: action.selected} : {}),
      };
    }
    case 'index':
      return {
        ...state,
        messageIndex: Math.max(0, Math.min(messageRows(state.history.items).length - 1, action.index)),
      };
    case 'selection':
      return {...state, selected: action.ids};
    case 'absent': {
      if (action.chatId !== state.activeId) return state;
      const items: Message[] = state.history.items.filter((message) => !action.ids.has(message.id));
      return {
        ...state,
        history: {...state.history, items},
        selected: new Set([...state.selected].filter((id) => !action.ids.has(id))),
        messageIndex: Math.max(0, Math.min(state.messageIndex, messageRows(items).length - 1)),
      };
    }
  }
}
