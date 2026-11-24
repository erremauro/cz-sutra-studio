<?php
/**
 * Frontend: shortcode [cz-sutra-studio] che monta l'app.
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

/**
 * URL della pagina che ospita l'app (per i link dall'amministrazione).
 */
function czss_app_page_url(): ?string
{
    $pages = get_posts([
        'post_type'      => 'page',
        'post_status'    => ['publish', 'private', 'draft'],
        'posts_per_page' => 1,
        's'              => '[cz-sutra-studio',
    ]);
    if ($pages) {
        return get_permalink($pages[0]) ?: null;
    }

    $page = get_page_by_path('utilita/studio-dei-sutra');

    return $page ? (get_permalink($page) ?: null) : null;
}

add_action('wp_enqueue_scripts', static function (): void {
    wp_register_style('czss-app', CZSS_URL . 'assets/app/app.css', [], (string) filemtime(CZSS_DIR . 'assets/app/app.css'));
    wp_register_script('czss-app', CZSS_URL . 'assets/app/app.js', [], (string) filemtime(CZSS_DIR . 'assets/app/app.js'), ['in_footer' => true, 'strategy' => 'defer']);
});

/**
 * Shortcode dell'app.
 *
 * @param array<string, string>|string $atts
 */
function czss_render_app(array|string $atts = []): string
{
    $atts = shortcode_atts(['sutra' => ''], is_array($atts) ? $atts : [], 'cz-sutra-studio');

    if (! wp_style_is('czss-app', 'registered')) {
        wp_register_style('czss-app', CZSS_URL . 'assets/app/app.css', [], (string) filemtime(CZSS_DIR . 'assets/app/app.css'));
        wp_register_script('czss-app', CZSS_URL . 'assets/app/app.js', [], (string) filemtime(CZSS_DIR . 'assets/app/app.js'), ['in_footer' => true, 'strategy' => 'defer']);
    }

    wp_enqueue_style('czss-app');
    wp_enqueue_script('czss-app');

    $sutras   = czss_get_all_sutras();
    $can_edit = current_user_can('edit_posts');

    if ($can_edit) {
        foreach ($sutras as &$sutra) {
            $sutra['editUrl'] = get_edit_post_link($sutra['postId'], 'raw');
        }
        unset($sutra);
    }

    $config = [
        'sutras'      => $sutras,
        'initial'     => sanitize_title($atts['sutra']),
        'artwork'     => get_site_icon_url(512) ?: '',
        'siteName'    => get_bloginfo('name'),
        'adminUrl'    => $can_edit ? admin_url('edit.php?post_type=' . CZSS_POST_TYPE) : '',
        'storageKey'  => 'czss:v1',
    ];

    $json = wp_json_encode($config, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);

    $noscript = '<noscript><p>' . esc_html__('Per usare lo Studio dei Sutra è necessario abilitare JavaScript.', 'cz-sutra-studio') . '</p></noscript>';

    return '<div class="czss-app" id="czss-app" data-state="loading">'
        . '<script type="application/json" class="czss-config">' . $json . '</script>'
        . '<div class="czss-app__boot" aria-hidden="true"><span></span><span></span><span></span></div>'
        . $noscript
        . '</div>';
}
add_shortcode('cz-sutra-studio', 'czss_render_app');
