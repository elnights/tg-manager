import type {Chat} from './telegram.js';
import type {Message, MessageView} from './messages.js';
import type {History} from './operations.js';

export type ViewState = {
  chats: Chat[];
  query: string;
  includePrivate: boolean;
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
  includePrivate: false,
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
      (state.includePrivate || !chat.isPrivate) &&
      (!state.ownOnly || state.ownChatIds.has(chat.id)) &&
      `${chat.title} ${chat.id}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()),
  );
}
function clearMessages(state: ViewState): ViewState {
  return {
    ...state,
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
  | {type: 'view'}
  | {type: 'reload'}
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
    case 'private': {
      const next =
        action.type === 'query'
          ? {...state, query: action.query}
          : {...state, includePrivate: !state.includePrivate};
      const chats = visibleChats(next);
      const activeId = chats.some((chat) => chat.id === state.activeId) ? state.activeId : chats[0]?.id;
      return activeId === state.activeId ? next : clearMessages({...next, activeId});
    }
    case 'active':
      return action.id === state.activeId ? state : clearMessages({...state, activeId: action.id});
    case 'view':
      return clearMessages({...state, view: state.view === 'mine' ? 'all' : 'mine'});
    case 'reload':
      return clearMessages(state);
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
        ...(action.selected ? {selected: action.selected} : {}),
      };
    }
    case 'index':
      return {...state, messageIndex: Math.max(0, Math.min(state.history.items.length - 1, action.index))};
    case 'selection':
      return {...state, selected: action.ids};
    case 'absent': {
      if (action.chatId !== state.activeId) return state;
      const items: Message[] = state.history.items.filter((message) => !action.ids.has(message.id));
      return {
        ...state,
        history: {...state.history, items},
        selected: new Set([...state.selected].filter((id) => !action.ids.has(id))),
        messageIndex: Math.max(0, Math.min(state.messageIndex, items.length - 1)),
      };
    }
  }
}
