import type {Chat} from './telegram.js';
import type {Message, MessageView} from './messages.js';
import type {History} from './operations.js';

export type ViewState = {
  chats: Chat[];
  query: string;
  includePrivate: boolean;
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
  | {type: 'chats'; chats: Chat[]}
  | {type: 'query'; query: string}
  | {type: 'private'}
  | {type: 'view'}
  | {type: 'reload'}
  | {type: 'active'; id: string | undefined}
  | {type: 'history'; chatId: string; view: MessageView; history: History; selected?: Set<number>}
  | {type: 'failed'; chatId: string; view: MessageView}
  | {type: 'index'; index: number}
  | {type: 'selection'; ids: Set<number>}
  | {type: 'absent'; chatId: string; ids: ReadonlySet<number>};
export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'chats': {
      const next = {...state, chats: action.chats};
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
    case 'history':
      return action.chatId === state.activeId && action.view === state.view
        ? {
            ...state,
            history: action.history,
            messageStatus: 'ready',
            ...(action.selected ? {selected: action.selected} : {}),
          }
        : state;
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
