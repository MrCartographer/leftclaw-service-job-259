import React from "react";
import { SwitchTheme } from "~~/components/SwitchTheme";

const CONTRACT_ADDRESS = "0x3be578a72d1c4ffdbb2aa2418a7fb749bcdba313";

/**
 * Site footer
 */
export const Footer = () => {
  return (
    <div className="min-h-0 py-5 px-4 border-t border-base-300 bg-base-100 mt-auto">
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 max-w-7xl mx-auto">
        <p className="m-0 text-sm text-base-content/70 text-center md:text-left">
          IndexerRegistry &mdash; Permissionless Event Indexer Registry on Base
        </p>
        <div className="flex items-center gap-4 text-sm">
          <a
            href={`https://basescan.org/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="link link-hover"
          >
            Contract
          </a>
          <a href="https://ethskills.com" target="_blank" rel="noreferrer" className="link link-hover">
            Docs
          </a>
          <SwitchTheme />
        </div>
      </div>
    </div>
  );
};
