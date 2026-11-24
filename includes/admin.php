<?php
/**
 * Amministrazione: editor delle schede, audio, colonne elenco.
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

/**
 * Editor classico per i sutra: le metabox a tutta larghezza sono molto più comode.
 */
add_filter('use_block_editor_for_post_type', static function (bool $use, string $post_type): bool {
    return CZSS_POST_TYPE === $post_type ? false : $use;
}, 10, 2);

add_filter('enter_title_here', static function (string $text, WP_Post $post): string {
    return CZSS_POST_TYPE === $post->post_type ? __('Titolo in romaji (es. Maka Hannya Haramita Shingyō)', 'cz-sutra-studio') : $text;
}, 10, 2);

/**
 * Campi dei titoli subito sotto il titolo principale.
 */
add_action('edit_form_after_title', static function (WP_Post $post): void {
    if (CZSS_POST_TYPE !== $post->post_type) {
        return;
    }

    wp_nonce_field('czss_save', 'czss_nonce');

    $kanji = (string) get_post_meta($post->ID, CZSS_META_KANJI, true);
    $transl = (string) get_post_meta($post->ID, CZSS_META_TRANSL, true);
    ?>
    <div class="czss-titles">
        <label class="czss-field">
            <span class="czss-field__label"><?php esc_html_e('Titolo originale (kanji)', 'cz-sutra-studio'); ?></span>
            <input type="text" name="czss_title_original" value="<?php echo esc_attr($kanji); ?>" class="czss-input czss-input--cjk" lang="ja" placeholder="摩訶般若波羅蜜多心経">
        </label>
        <label class="czss-field">
            <span class="czss-field__label"><?php esc_html_e('Titolo tradotto', 'cz-sutra-studio'); ?></span>
            <input type="text" name="czss_title_translation" value="<?php echo esc_attr($transl); ?>" class="czss-input" placeholder="<?php esc_attr_e('Essenza del Sutra della Grande Saggezza…', 'cz-sutra-studio'); ?>">
        </label>
    </div>
    <h2 class="czss-desc-heading"><?php esc_html_e('Introduzione', 'cz-sutra-studio'); ?> <small><?php esc_html_e('— mostrata nell’app prima delle schede', 'cz-sutra-studio'); ?></small></h2>
    <?php
});

add_action('add_meta_boxes_' . CZSS_POST_TYPE, static function (): void {
    add_meta_box(
        'czss-studio',
        __('Audio e schede', 'cz-sutra-studio'),
        'czss_render_studio_metabox',
        CZSS_POST_TYPE,
        'normal',
        'high'
    );
});

function czss_render_studio_metabox(WP_Post $post): void
{
    $audio = czss_get_audio($post->ID);
    $cards = czss_get_cards($post->ID);
    ?>
    <input type="hidden" name="czss_audio_id" id="czss-audio-id" value="<?php echo esc_attr((string) ($audio['id'] ?? '')); ?>">
    <input type="hidden" name="czss_cards_json" id="czss-cards-json" value="<?php echo esc_attr(wp_json_encode($cards, JSON_UNESCAPED_UNICODE)); ?>">
    <div id="czss-editor" class="czss-editor" data-audio="<?php echo esc_attr(wp_json_encode($audio)); ?>">
        <p class="czss-loading"><?php esc_html_e('Caricamento editor…', 'cz-sutra-studio'); ?></p>
    </div>
    <noscript><p><?php esc_html_e('L’editor delle schede richiede JavaScript.', 'cz-sutra-studio'); ?></p></noscript>
    <?php
}

add_action('save_post_' . CZSS_POST_TYPE, static function (int $post_id): void {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (! isset($_POST['czss_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['czss_nonce'])), 'czss_save')) {
        return;
    }
    if (! current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, CZSS_META_KANJI, sanitize_text_field(wp_unslash($_POST['czss_title_original'] ?? '')));
    update_post_meta($post_id, CZSS_META_TRANSL, sanitize_text_field(wp_unslash($_POST['czss_title_translation'] ?? '')));

    $audio_id = absint($_POST['czss_audio_id'] ?? 0);
    if ($audio_id > 0 && 'attachment' === get_post_type($audio_id)) {
        update_post_meta($post_id, CZSS_META_AUDIO, $audio_id);
    } else {
        delete_post_meta($post_id, CZSS_META_AUDIO);
    }

    if (isset($_POST['czss_cards_json'])) {
        // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanificato card per card.
        $decoded = json_decode(wp_unslash($_POST['czss_cards_json']), true);
        if (is_array($decoded)) {
            czss_save_cards($post_id, czss_sanitize_cards($decoded));
        }
    }
}, 10);

add_action('admin_enqueue_scripts', static function (string $hook): void {
    $screen = get_current_screen();
    if (! $screen || CZSS_POST_TYPE !== $screen->post_type) {
        return;
    }

    wp_enqueue_style('czss-admin', CZSS_URL . 'assets/admin/editor.css', [], (string) filemtime(CZSS_DIR . 'assets/admin/editor.css'));

    if (! in_array($hook, ['post.php', 'post-new.php'], true)) {
        return;
    }

    wp_enqueue_media();
    wp_enqueue_script('czss-admin', CZSS_URL . 'assets/admin/editor.js', ['jquery-ui-sortable'], (string) filemtime(CZSS_DIR . 'assets/admin/editor.js'), true);
});

/**
 * Alcuni .m4a (es. registrazioni da iPhone) vengono riconosciuti dal server come video/mp4
 * e WordPress li rifiuta: li accettiamo come audio.
 *
 * @param array<string, mixed> $data
 * @return array<string, mixed>
 */
add_filter('wp_check_filetype_and_ext', static function (array $data, string $file, string $filename): array {
    if (! empty($data['ext']) || 'm4a' !== strtolower(pathinfo($filename, PATHINFO_EXTENSION))) {
        return $data;
    }
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $real  = $finfo ? finfo_file($finfo, $file) : '';
        if ($finfo) {
            finfo_close($finfo);
        }
        if (in_array($real, ['video/mp4', 'audio/mp4', 'audio/x-m4a', 'application/octet-stream'], true)) {
            return ['ext' => 'm4a', 'type' => 'audio/mp4', 'proper_filename' => false];
        }
    }
    return $data;
}, 10, 3);

/**
 * Colonne dell'elenco sutra.
 */
add_filter('manage_' . CZSS_POST_TYPE . '_posts_columns', static function (array $columns): array {
    $new = [];
    foreach ($columns as $key => $label) {
        if ('date' === $key) {
            continue;
        }
        $new[$key] = $label;
        if ('title' === $key) {
            $new['czss_original'] = __('Originale', 'cz-sutra-studio');
            $new['czss_cards']    = __('Schede', 'cz-sutra-studio');
            $new['czss_audio']    = __('Audio', 'cz-sutra-studio');
            $new['czss_order']    = __('Ordine', 'cz-sutra-studio');
        }
    }
    return $new;
});

add_action('manage_' . CZSS_POST_TYPE . '_posts_custom_column', static function (string $column, int $post_id): void {
    switch ($column) {
        case 'czss_original':
            echo '<span lang="ja">' . esc_html((string) get_post_meta($post_id, CZSS_META_KANJI, true)) . '</span>';
            break;
        case 'czss_cards':
            $cards = czss_get_cards($post_id);
            $timed = count(array_filter($cards, static fn ($c) => isset($c['start']) && null !== $c['start']));
            printf('%d <span class="czss-muted">(%d %s)</span>', count($cards), $timed, esc_html__('con tempi', 'cz-sutra-studio'));
            break;
        case 'czss_audio':
            $audio = czss_get_audio($post_id);
            if ($audio) {
                $d = $audio['duration'];
                echo '✓ ' . esc_html(null !== $d ? sprintf('%d:%02d', (int) floor($d / 60), (int) $d % 60) : '');
            } else {
                echo '<span class="czss-muted">—</span>';
            }
            break;
        case 'czss_order':
            echo (int) get_post_field('menu_order', $post_id);
            break;
    }
}, 10, 2);

add_filter('manage_edit-' . CZSS_POST_TYPE . '_sortable_columns', static function (array $columns): array {
    $columns['czss_order'] = 'menu_order';
    return $columns;
});

add_action('pre_get_posts', static function (WP_Query $query): void {
    if (! is_admin() || ! $query->is_main_query() || CZSS_POST_TYPE !== $query->get('post_type')) {
        return;
    }
    if (! $query->get('orderby')) {
        $query->set('orderby', ['menu_order' => 'ASC', 'title' => 'ASC']);
    }
});

/**
 * Link rapido all'app dalla barra admin dell'elenco.
 */
add_action('admin_notices', static function (): void {
    $screen = get_current_screen();
    if (! $screen || 'edit-' . CZSS_POST_TYPE !== $screen->id) {
        return;
    }
    $url = czss_app_page_url();
    if (! $url) {
        return;
    }
    printf(
        '<div class="notice notice-info czss-notice"><p>%s <a href="%s" target="_blank" rel="noopener">%s</a></p></div>',
        esc_html__('L’ordine dei sutra nell’app segue il campo “Ordine” (Attributi). Le raccolte raggruppano i sutra nella libreria.', 'cz-sutra-studio'),
        esc_url($url),
        esc_html__('Apri l’app ↗', 'cz-sutra-studio')
    );
});
