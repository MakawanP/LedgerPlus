import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Banknote, Briefcase } from 'lucide-react';
import { resolveMerchantBrand } from '../utils/merchantLogo';

interface MerchantLogoProps {
  merchant: string;
  rawDescription?: string;
  transactionType?: 'purchase' | 'refund' | 'income' | 'transfer';
  paymentMethod?: string;
  size?: 'sm' | 'md';
}

export const MerchantLogo: React.FC<MerchantLogoProps> = ({
  merchant,
  rawDescription,
  transactionType,
  paymentMethod,
  size = 'sm',
}) => {
  const brand = resolveMerchantBrand(merchant, {
    rawDescription,
    transactionType,
    paymentMethod,
  });

  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>(
    brand.logoEndpointUrl ? 'loading' : 'error'
  );

  useEffect(() => {
    setImgState(brand.logoEndpointUrl ? 'loading' : 'error');
  }, [brand.logoEndpointUrl]);

  const dimensions = size === 'md' ? 'w-8 h-8 text-xs' : 'w-7 h-7 text-[11px]';
  const imgPadding = size === 'md' ? 'p-1' : 'p-1';

  return (
    <div
      title={brand.domain ? `${merchant} (${brand.domain})` : merchant}
      className={`relative ${dimensions} rounded-md border shrink-0 flex items-center justify-center overflow-hidden select-none font-display font-semibold tracking-tight ${
        imgState === 'loaded'
          ? 'bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700'
          : brand.fallbackKind === 'income'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70'
          : brand.fallbackKind === 'transfer'
          ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
          : brand.tintClass
      }`}
    >
      {/* Resilient Fallback Layer (always rendered cleanly until company icon finishes loading) */}
      {imgState !== 'loaded' && (
        <>
          {brand.fallbackKind === 'income' ? (
            <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
          ) : brand.fallbackKind === 'transfer' ? (
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
          ) : brand.fallbackKind === 'cash' ? (
            <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">{brand.monogram}</span>
          )}
        </>
      )}

      {/* Automated Favicon / Company Logo Image */}
      {brand.logoEndpointUrl && imgState !== 'error' && (
        <img
          src={brand.logoEndpointUrl}
          alt={`${merchant} company icon`}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={(e) => {
            const target = e.currentTarget;
            if (target.naturalWidth <= 1 || target.naturalHeight <= 1) {
              setImgState('error');
            } else {
              setImgState('loaded');
            }
          }}
          onError={() => setImgState('error')}
          className={`w-full h-full object-contain ${imgPadding} transition-opacity duration-150 ${
            imgState === 'loaded' ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        />
      )}
    </div>
  );
};
