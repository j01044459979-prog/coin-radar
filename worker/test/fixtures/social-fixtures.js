// 테스트 전용: Telegram 공개 미리보기(t.me/s/<채널>) · RSS · 커뮤니티 목록 형태의 가짜 응답 생성기.
// ⚠️ 실제 t.me / Coinpan 응답이 아니라 알려진 위젯 구조를 흉내 낸 mock 입니다 (실제 연결 검증 아님).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// messages: [{ id, text(html 허용: raw), at(ms), views, links:[href], noText, other(채널명 다른 글) }]
export function tgMessage(user, m) {
  const body = m.noText ? '' : `<div class="tgme_widget_message_text js-message_text" dir="auto">${m.raw !== undefined ? m.raw : esc(m.text)}${(m.links || []).map((l) => ` <a href="${l}" target="_blank" rel="noopener">${l}</a>`).join('')}</div>`;
  const post = `${m.other || user}/${m.id}`;
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${post}" data-view="eyJjIjotMTIzLCJwIjoxMjMsInQiOjE3MDAwMDAwMDB9">
<div class="tgme_widget_message_user"><a href="https://t.me/${user}"><i class="tgme_widget_message_user_photo bgcolor3" data-content="W"><img src="https://cdn4.cdn-telegram.org/file/abc.jpg"></i></a></div>
<div class="tgme_widget_message_bubble"><i class="tgme_widget_message_bubble_tail"><svg class="bubble_icon" width="9px" height="20px" viewBox="0 0 9 20"><g fill="none"><path class="corner" fill="#fff" d="M6,17 C3.8,19.4 2.3,19.8 0,20 L9,20 L9,0 L6,17 Z"></path></g></svg></i>
<div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/${user}"><span dir="auto">${user}</span></a></div>
${body}
<div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info"><span class="tgme_widget_message_views">${m.views || '1.2K'}</span><span class="copyonly"> </span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/${post}"><time datetime="${new Date(m.at).toISOString().replace('Z', '+00:00')}" class="time">12:00</time></a></span></div></div></div></div></div>`;
}

export function tgPage(user, messages) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Telegram: Contact @${user}</title><script>window.x=1;</script></head><body class="widget_frame_base tgme_page_widget">
<header class="tgme_header"><div class="tgme_header_info"><div class="tgme_header_title">${user}</div><div class="tgme_header_counter">50K subscribers</div></div></header>
<main class="tgme_main"><section class="tgme_channel_history js-message_history">${messages.map((m) => tgMessage(user, m)).join('\n')}</section></main></body></html>`;
}

export const tgEmptyPage = (user) => `<!DOCTYPE html><html><body class="tgme_page_widget"><header class="tgme_header"><div class="tgme_header_title">${user}</div></header><main class="tgme_main"><section class="tgme_channel_history js-message_history"></section></main></body></html>`;
// 공개 미리보기가 꺼진 채널은 t.me/<채널> 소개 페이지로 이동 (메시지 영역 없음)
export const tgNoPreviewPage = (user) => `<!DOCTYPE html><html><body><div class="tgme_page"><div class="tgme_page_title">${user}</div><a class="tgme_action_button_new" href="tg://resolve?domain=${user}">View in Telegram</a></div></body></html>`;

export function rssFeed(items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) => `<item><title>${esc(i.title)}</title><link>${i.link}</link>${i.at ? `<pubDate>${new Date(i.at).toUTCString()}</pubDate>` : ''}<description>${esc(i.desc || '')}</description><author>user123@example.com (nick)</author><dc:creator>닉네임A</dc:creator></item>`).join('')}</channel></rss>`;
}

// 게시판 HTML 목록: 제목 링크 + 댓글수 + (읽으면 안 되는) 작성자 칸
export function boardHtml(host, posts) {
  return `<html><body><table class="bd_lst"><tbody>${posts.map((p) => `<tr><td class="no">${p.id}</td><td class="title"><a href="https://${host}/${p.board || 'free'}/${p.id}">${esc(p.title)}</a> <a class="replyNum" href="#c">[${p.comments ?? 0}]</a></td><td class="author"><a href="#member_${p.id}" class="member_9999">${esc(p.author || '작성자닉')}</a></td><td class="time">12:34</td></tr>`).join('')}</tbody></table><a href="https://${host}/notice">공지</a><a href="https://evil.example/12345">외부</a></body></html>`;
}
