<?php
/**
 * Modello dati: meta, sanificazione ed esportazione verso il frontend.
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

const CZSS_POST_TYPE   = 'cz_sutra';
const CZSS_TAXONOMY    = 'cz_sutra_raccolta';
const CZSS_META_CARDS  = '_czss_cards';
const CZSS_META_AUDIO  = '_czss_audio_id';
const CZSS_META_KANJI  = '_czss_title_original';
const CZSS_META_TRANSL = '_czss_title_translation';

/**
 * Tag HTML ammessi nei testi delle schede (formattazione leggera + furigana).
 *
 * @return array<string, array<string, bool>>
 */
function czss_allowed_html(): array
{
    $plain = [];
    $with_class = ['class' => true];

    return [
        'b'      => $plain,
        'strong' => $plain,
        'i'      => $plain,
        'em'     => $plain,
        'u'      => $plain,
        'mark'   => $plain,
        'small'  => $plain,
        'sup'    => $plain,
        'sub'    => $plain,
        'br'     => $plain,
        'span'   => $with_class,
        'ruby'   => $plain,
        'rt'     => $plain,
        'rp'     => $plain,
        'a'      => ['href' => true, 'target' => true, 'rel' => true],
    ];
}

/**
 * Sanifica un testo multilinea mantenendo gli a capo e l'HTML ammesso.
 */
function czss_sanitize_text(mixed $value): string
{
    if (! is_string($value)) {
        return '';
    }

    $value = str_replace(["\r\n", "\r"], "\n", $value);

    return trim(wp_kses($value, czss_allowed_html()));
}

/**
 * Converte un tempo (secondi, "m:ss", "m:ss.ms", "h:mm:ss") in secondi.
 */
function czss_parse_time(mixed $value): ?float
{
    if (is_int($value) || is_float($value)) {
        return $value >= 0 ? round((float) $value, 3) : null;
    }

    if (! is_string($value)) {
        return null;
    }

    $value = trim(str_replace(',', '.', $value));
    if ('' === $value) {
        return null;
    }

    if (is_numeric($value)) {
        $seconds = (float) $value;
        return $seconds >= 0 ? round($seconds, 3) : null;
    }

    if (! preg_match('/^(\d+:)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/', $value, $m)) {
        return null;
    }

    $hours   = '' !== $m[1] ? (int) rtrim($m[1], ':') : 0;
    $minutes = (int) $m[2];
    $seconds = (float) $m[3];

    return round($hours * 3600 + $minutes * 60 + $seconds, 3);
}

/**
 * Sanifica una singola scheda.
 *
 * @param array<string, mixed> $card
 * @return array<string, mixed>|null
 */
function czss_sanitize_card(array $card): ?array
{
    $id = isset($card['id']) && is_string($card['id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $card['id']) : '';
    if ('' === $id) {
        $id = 'c' . strtolower(wp_generate_password(8, false, false));
    }

    $clean = [
        'id'          => substr($id, 0, 40),
        'original'    => czss_sanitize_text($card['original'] ?? ''),
        'romaji'      => czss_sanitize_text($card['romaji'] ?? ''),
        'translation' => czss_sanitize_text($card['translation'] ?? ''),
        'note'        => czss_sanitize_text($card['note'] ?? ''),
        'start'       => czss_parse_time($card['start'] ?? null),
        'end'         => czss_parse_time($card['end'] ?? null),
    ];

    if (null !== $clean['start'] && null !== $clean['end'] && $clean['end'] <= $clean['start']) {
        $clean['end'] = null;
    }

    $has_content = '' !== $clean['original'] || '' !== $clean['romaji'] || '' !== $clean['translation'] || '' !== $clean['note'];

    return $has_content ? $clean : null;
}

/**
 * Sanifica l'elenco delle schede.
 *
 * @param mixed $cards
 * @return array<int, array<string, mixed>>
 */
function czss_sanitize_cards(mixed $cards): array
{
    if (! is_array($cards)) {
        return [];
    }

    $result = [];
    $seen   = [];
    foreach ($cards as $card) {
        if (! is_array($card)) {
            continue;
        }
        $clean = czss_sanitize_card($card);
        if (null === $clean) {
            continue;
        }
        if (isset($seen[$clean['id']])) {
            $clean['id'] .= '-' . count($result);
        }
        $seen[$clean['id']] = true;
        $result[] = $clean;
    }

    return $result;
}

/**
 * Restituisce le schede di un sutra.
 *
 * @return array<int, array<string, mixed>>
 */
function czss_get_cards(int $post_id): array
{
    $raw = get_post_meta($post_id, CZSS_META_CARDS, true);
    if (! is_string($raw) || '' === $raw) {
        return [];
    }

    $decoded = json_decode($raw, true);

    return is_array($decoded) ? $decoded : [];
}

/**
 * Salva le schede di un sutra (già sanificate).
 *
 * @param array<int, array<string, mixed>> $cards
 */
function czss_save_cards(int $post_id, array $cards): void
{
    update_post_meta(
        $post_id,
        CZSS_META_CARDS,
        wp_slash(wp_json_encode(array_values($cards), JSON_UNESCAPED_UNICODE))
    );
}

/**
 * Informazioni sull'audio associato.
 *
 * @return array{id:int,url:string,duration:?float,mime:string,title:string,vbr:bool}|null
 */
function czss_get_audio(int $post_id): ?array
{
    $attachment_id = (int) get_post_meta($post_id, CZSS_META_AUDIO, true);
    if ($attachment_id <= 0) {
        return null;
    }

    $url = wp_get_attachment_url($attachment_id);
    if (! $url) {
        return null;
    }

    $meta     = wp_get_attachment_metadata($attachment_id);
    $duration = is_array($meta) && isset($meta['length']) && is_numeric($meta['length']) ? (float) $meta['length'] : null;

    $mime = (string) get_post_mime_type($attachment_id);

    return [
        'id'       => $attachment_id,
        'url'      => $url,
        'duration' => $duration,
        'mime'     => $mime,
        'title'    => get_the_title($attachment_id),
        // MP3 a bitrate variabile: il browser non riesce a saltare con precisione ai tempi delle schede
        'vbr'      => 'audio/mpeg' === $mime && is_array($meta) && 'vbr' === ($meta['bitrate_mode'] ?? ''),
    ];
}

/**
 * Esporta un sutra nel formato usato dall'app.
 *
 * @return array<string, mixed>
 */
function czss_export_sutra(WP_Post $post): array
{
    $audio = czss_get_audio($post->ID);
    $terms = get_the_terms($post, CZSS_TAXONOMY);
    $group = is_array($terms) && $terms ? $terms[0] : null;

    $description = (string) $post->post_content;
    $description = '' !== trim($description) ? wpautop(wp_kses_post($description)) : '';

    $cards = czss_get_cards($post->ID);

    $content_hash = substr(md5(wp_json_encode($cards) . ($audio['url'] ?? '')), 0, 10);

    return [
        'slug'             => $post->post_name,
        'postId'           => $post->ID,
        'title'            => get_the_title($post),
        'titleOriginal'    => (string) get_post_meta($post->ID, CZSS_META_KANJI, true),
        'titleTranslation' => (string) get_post_meta($post->ID, CZSS_META_TRANSL, true),
        'group'            => $group ? ['slug' => $group->slug, 'name' => $group->name] : null,
        'description'      => $description,
        'audio'            => $audio ? ['url' => $audio['url'], 'duration' => $audio['duration'], 'mime' => $audio['mime']] : null,
        'cards'            => $cards,
        'version'          => $content_hash,
    ];
}

/**
 * Tutti i sutra pubblicati, nell'ordine definito in amministrazione.
 *
 * @return array<int, array<string, mixed>>
 */
function czss_get_all_sutras(): array
{
    $posts = get_posts([
        'post_type'        => CZSS_POST_TYPE,
        'post_status'      => 'publish',
        'posts_per_page'   => -1,
        'orderby'          => ['menu_order' => 'ASC', 'title' => 'ASC'],
        'suppress_filters' => false,
    ]);

    return array_map('czss_export_sutra', $posts);
}
