<?php
/**
 * Plugin Name: CZ Sutra Studio
 * Description: App responsive per lo studio dei sutra: audio, schede con testo originale, romaji, traduzione e note, sincronizzate con l'audio. Tutto gestito da WordPress.
 * Version: 1.1.0
 * Author: Roberto Mauro
 * License: ISC
 * Text Domain: cz-sutra-studio
 * Requires PHP: 8.0
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

define('CZSS_VERSION', '1.1.0');
define('CZSS_FILE', __FILE__);
define('CZSS_DIR', plugin_dir_path(__FILE__));
define('CZSS_URL', plugin_dir_url(__FILE__));

require_once CZSS_DIR . 'includes/data.php';
require_once CZSS_DIR . 'includes/post-type.php';
require_once CZSS_DIR . 'includes/admin.php';
require_once CZSS_DIR . 'includes/frontend.php';

if (defined('WP_CLI') && WP_CLI) {
    require_once CZSS_DIR . 'includes/cli.php';
}

register_activation_hook(__FILE__, static function (): void {
    czss_register_post_type();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, static function (): void {
    flush_rewrite_rules();
});
